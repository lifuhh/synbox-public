// The asks ledger: every ask the owner makes, from the message to the PR that lands it, so none is dropped
// between sessions. A global Claude Code hook (~/.claude/hooks/capture-asks.py) appends each prompt typed in
// ~/github-workspace to the inbox; this tool sweeps the same sessions' transcripts for messages queued mid-task,
// files them as asks, and tracks each ask's status.
//
//   bun harness/asks.ts triage                       inbox messages not yet filed, with how to file each
//   bun harness/asks.ts new "<quote>" --from <key>   file one as an ask (--project, --status, --pr, ... below)
//   bun harness/asks.ts skip <key>...                not an ask (a question answered in chat, a reply, a thanks)
//   bun harness/asks.ts link <id> <key>...           a follow-up message that belongs to an existing ask
//   bun harness/asks.ts set <id> <status> [--pr fe#N] [--log <file>] [--blocker "…" --unblocked-by <condition>]
//   bun harness/asks.ts cleared <condition>          a condition came true: its deferred asks reopen
//   bun harness/asks.ts list [--all] [--project p]   deferred (with blockers), in progress and open; --all adds the rest
//   bun harness/asks.ts report                       the short block for final reports and ship questions
//   bun harness/asks.ts show <id>                    one ask in full
//   bun harness/asks.ts import <transcript.jsonl>    a session's owner messages into the inbox (backfill)
//
// Everything lives in the synbox main checkout's gitignored docs/private/asks/ (SYNBOX_ASKS_DIR overrides): the
// hook's inbox.jsonl, this tool's transcripts.jsonl (messages found in transcripts) and ledger.json. Prompts may
// hold anything, so none of it is ever committed. Each file has one writer: the hook appends the inbox, this tool
// writes the other two.

import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { z } from 'zod'

const STATUSES = [
  'open',
  'in_progress',
  'done',
  'deferred',
  'declined',
] as const
type Status = (typeof STATUSES)[number]

const PROJECTS = [
  'frontend',
  'backend',
  'both',
  'dev-process',
  'other',
] as const
type Project = (typeof PROJECTS)[number]
const PROJECT_TAG: Record<Project, string> = {
  backend: 'be',
  both: 'fe+be',
  'dev-process': 'dev',
  frontend: 'fe',
  other: 'other',
}

// What a deferred ask can wait on. `cleared <condition>` reopens every ask waiting on it; anything else is the
// owner's own condition, cleared by hand.
const CONDITIONS: Record<string, string> = {
  'appwrite-downgraded': 'the Appwrite plan is back on Free',
  'backend-released': 'backend staging released to Cloud Run',
  'frontend-released': 'frontend staging released to synbox.io',
  owner: 'the owner decides or acts (held, or theirs to do)',
  'worker-deployed': 'the auth Worker deployed (wrangler deploy)',
}

// Read through these schemas, so a hand-edited or older file fails loudly instead of half-working
const InboxItemSchema = z.object({
  chars: z.number(),
  cwd: z.string(),
  key: z.string(),
  prompt: z.string(),
  session_id: z.string(),
  source: z.enum(['hook', 'transcript']),
  time: z.string(),
  transcript_path: z.string(),
  truncated: z.boolean(),
})
type InboxItem = z.infer<typeof InboxItemSchema>

const StatusSchema = z.enum(STATUSES)
const ProjectSchema = z.enum(PROJECTS)

const AskSchema = z.object({
  blocker: z.string().optional(),
  created: z.string(),
  id: z.string(),
  inbox: z.array(z.string()),
  logs: z.array(z.string()),
  note: z.string().optional(),
  project: ProjectSchema,
  prs: z.array(z.string()),
  quote: z.string(),
  session: z.string(),
  status: StatusSchema,
  unblocked_by: z.string().optional(),
  updated: z.string(),
})
type Ask = z.infer<typeof AskSchema>

const LedgerSchema = z.object({
  asks: z.array(AskSchema),
  swept: z.record(z.string(), z.number()),
  triaged: z.record(z.string(), z.string()),
  v: z.literal(1),
})
type Ledger = z.infer<typeof LedgerSchema>

const MAX_PROMPT = 8000
const MAX_QUOTE = 280
const PR_REF = /^(?:fe|be)#\d+$/u
const NOT_THE_OWNER = [
  '<task-notification',
  '<cross-session-message',
  '<agent-message',
  '<teammate-message',
  'This session is being continued from a previous conversation',
]

const dir =
  process.env.SYNBOX_ASKS_DIR ??
  path.join(homedir(), 'github-workspace', 'synbox', 'docs', 'private', 'asks')
// Steps only the owner can do (a portal setting, a phone check), one checklist beside the asks (AGENTS.md › "Owner
// steps"); the report lists the open ones
const ownerSteps = path.join(dir, '..', 'owner-steps.md')
const OPEN_STEP = /^- \[ \] \*\*(?<title>[^*]+)\*\*/u

const openOwnerSteps = (): string[] => {
  if (!existsSync(ownerSteps)) {
    return []
  }
  const text = readFileSync(ownerSteps, 'utf8')
  const open =
    text.split(/^## /mu).find((part) => part.startsWith('Open')) ?? ''
  return open
    .split('\n')
    .map((line) => OPEN_STEP.exec(line)?.groups?.title)
    .filter((title): title is string => title !== undefined)
}

const files = {
  inbox: path.join(dir, 'inbox.jsonl'),
  ledger: path.join(dir, 'ledger.json'),
  lock: path.join(dir, 'ledger.lock'),
  transcripts: path.join(dir, 'transcripts.jsonl'),
}

// Thrown, not exited, so a refusal inside withLedger still releases the lock
class RefusalError extends Error {
  override name = 'RefusalError'
}
const stop: (message: string) => never = (message) => {
  throw new RefusalError(message)
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/u, 'Z')
const keyOf = (session: string, prompt: string) =>
  createHash('sha256')
    .update(`${session}\n${prompt}`)
    .digest('hex')
    .slice(0, 16)
const oneLine = (text: string, max: number) => {
  const flat = text.replaceAll(/\s+/gu, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// One bad line (a write cut short) is skipped, not fatal: the rest of the inbox is still read
const readJsonl = (file: string): InboxItem[] =>
  existsSync(file)
    ? readFileSync(file, 'utf-8')
        .split('\n')
        .flatMap((line) => {
          try {
            const parsed = InboxItemSchema.safeParse(JSON.parse(line))
            return parsed.success ? [parsed.data] : []
          } catch {
            return []
          }
        })
    : []

const emptyLedger = (): Ledger => ({ asks: [], swept: {}, triaged: {}, v: 1 })

const readLedger = (): Ledger =>
  existsSync(files.ledger)
    ? LedgerSchema.parse(JSON.parse(readFileSync(files.ledger, 'utf-8')))
    : emptyLedger()

// Sessions run this tool side by side: a change is read, applied and written under one lock, and written whole
// to a temporary file first, so a reader never sees half a ledger.
const withLedger = <T>(change: (ledger: Ledger) => T): T => {
  mkdirSync(dir, { recursive: true })
  let fd: number | undefined
  for (let attempt = 0; fd === undefined; attempt += 1) {
    try {
      fd = openSync(files.lock, 'wx')
    } catch {
      if (attempt === 0 && Date.now() - statSync(files.lock).mtimeMs > 30_000) {
        rmSync(files.lock, { force: true })
      } else if (attempt > 100) {
        stop(
          `The ledger is locked by another run (${files.lock}). Retry; delete it if no asks.ts is running.`
        )
      } else {
        Bun.sleepSync(50)
      }
    }
  }
  try {
    const ledger = readLedger()
    const result = change(ledger)
    const temporary = `${files.ledger}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`)
    renameSync(temporary, files.ledger)
    return result
  } finally {
    closeSync(fd)
    rmSync(files.lock, { force: true })
  }
}

// --- Transcripts: the owner's messages a session queued mid-task, which may not reach the hook -----------------

const ContentSchema = z.union([
  z.string(),
  z.array(z.object({ text: z.unknown(), type: z.unknown() }).partial()),
])

const TranscriptLineSchema = z.object({
  attachment: z
    .object({ prompt: ContentSchema.optional(), type: z.string().optional() })
    .optional(),
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
  message: z.object({ content: ContentSchema.optional() }).optional(),
  sessionId: z.string().optional(),
  timestamp: z.string().optional(),
  toolUseResult: z.unknown().optional(),
  type: z.string().optional(),
})
type TranscriptLine = z.infer<typeof TranscriptLineSchema>

const textOf = (
  content: z.infer<typeof ContentSchema> | undefined
): string | undefined => {
  if (content === undefined || typeof content === 'string') {
    return content
  }
  if (content.some((block) => block.type === 'tool_result')) {
    return undefined
  }
  const texts = content.flatMap((block) =>
    block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  )
  return texts.length > 0 ? texts.join('\n') : undefined
}

// A slash command is stored expanded; the hook saw it as typed (`/name args`), and the key must match
const asTyped = (text: string) => {
  const name = /<command-name>(?<name>[^<]*)<\/command-name>/u.exec(text)
    ?.groups?.name
  if (name === undefined || name === '') {
    return text
  }
  const args =
    /<command-args>(?<args>[\s\S]*?)<\/command-args>/u.exec(text)?.groups
      ?.args ?? ''
  return `${name.startsWith('/') ? name : `/${name}`} ${args}`.trim()
}

const ownerPrompt = (line: TranscriptLine): string | undefined => {
  if (line.isMeta === true || line.isSidechain === true) {
    return undefined
  }
  let text: string | undefined
  if (line.type === 'user' && line.toolUseResult === undefined) {
    text = textOf(line.message?.content)
  } else if (
    line.type === 'attachment' &&
    line.attachment?.type === 'queued_command'
  ) {
    text = textOf(line.attachment.prompt)
  }
  if (text === undefined) {
    return undefined
  }
  const prompt = asTyped(text.trim())
  if (
    prompt === '' ||
    NOT_THE_OWNER.some((prefix) => prompt.startsWith(prefix))
  ) {
    return undefined
  }
  if (prompt.startsWith('<local-command') || prompt.startsWith('<bash-')) {
    return undefined
  }
  if (prompt.startsWith('[Request interrupted')) {
    return undefined
  }
  if (prompt.startsWith('/') && prompt.split(/\s+/u).length === 1) {
    return undefined
  }
  return prompt
}

// Reads a transcript from where the last sweep stopped, up to its last complete line
const sweepOne = (
  ledger: Ledger,
  transcript: string,
  known: Set<string>
): InboxItem[] => {
  if (!existsSync(transcript)) {
    return []
  }
  const { size } = statSync(transcript)
  const from = ledger.swept[transcript] ?? 0
  if (size <= from) {
    return []
  }
  const buffer = Buffer.alloc(size - from)
  const fd = openSync(transcript, 'r')
  try {
    readSync(fd, buffer, 0, buffer.length, from)
  } finally {
    closeSync(fd)
  }
  const end = buffer.lastIndexOf(0x0a) + 1
  ledger.swept[transcript] = from + end
  const found: InboxItem[] = []
  for (const raw of buffer.subarray(0, end).toString('utf-8').split('\n')) {
    let line: TranscriptLine
    try {
      const parsed = TranscriptLineSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        continue
      }
      line = parsed.data
    } catch {
      continue
    }
    const prompt = ownerPrompt(line)
    if (prompt === undefined) {
      continue
    }
    const session = line.sessionId ?? path.basename(transcript, '.jsonl')
    const key = keyOf(session, prompt)
    if (known.has(key)) {
      continue
    }
    known.add(key)
    found.push({
      chars: prompt.length,
      cwd: '',
      key,
      prompt: prompt.slice(0, MAX_PROMPT),
      session_id: session,
      source: 'transcript',
      time: line.timestamp ?? now(),
      transcript_path: transcript,
      truncated: prompt.length > MAX_PROMPT,
    })
  }
  return found
}

const appendTranscriptItems = (items: InboxItem[]) => {
  if (items.length === 0) {
    return
  }
  mkdirSync(dir, { recursive: true })
  const existing = existsSync(files.transcripts)
    ? readFileSync(files.transcripts, 'utf-8')
    : ''
  writeFileSync(
    files.transcripts,
    existing + items.map((item) => `${JSON.stringify(item)}\n`).join('')
  )
}

// Every session the hook saw, plus any imported transcript, read on from where the last sweep stopped
const sweep = (ledger: Ledger, extra: string[] = []) => {
  const hookItems = readJsonl(files.inbox)
  const known = new Set([
    ...hookItems.map((item) => item.key),
    ...readJsonl(files.transcripts).map((item) => item.key),
  ])
  const transcripts = new Set([
    ...Object.keys(ledger.swept),
    ...hookItems.map((item) => item.transcript_path).filter((p) => p !== ''),
    ...extra,
  ])
  const found = [...transcripts].flatMap((transcript) =>
    sweepOne(ledger, transcript, known)
  )
  appendTranscriptItems(found)
  return found.length
}

const inbox = () =>
  [...readJsonl(files.inbox), ...readJsonl(files.transcripts)].toSorted(
    (a, b) => a.time.localeCompare(b.time)
  )

// --- Commands --------------------------------------------------------------------------------------------------

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: {
    all: { default: false, type: 'boolean' },
    blocker: { type: 'string' },
    created: { type: 'string' },
    from: { multiple: true, type: 'string' },
    log: { multiple: true, type: 'string' },
    note: { type: 'string' },
    pr: { multiple: true, type: 'string' },
    project: { type: 'string' },
    session: { type: 'string' },
    status: { type: 'string' },
    'unblocked-by': { type: 'string' },
  },
})

const parseStatus = (value: string | undefined, fallback: Status): Status => {
  if (value === undefined) {
    return fallback
  }
  const parsed = StatusSchema.safeParse(value)
  return parsed.success
    ? parsed.data
    : stop(`Unknown status "${value}". One of: ${STATUSES.join(', ')}.`)
}

const parseProject = (value: string | undefined): Project => {
  const parsed = ProjectSchema.safeParse(value)
  return parsed.success
    ? parsed.data
    : stop(
        `--project needs one of ${PROJECTS.join(', ')}${value === undefined ? '' : `, not "${value}"`}.`
      )
}

const parsePrs = (values: string[] | undefined) =>
  (values ?? []).map((value) =>
    PR_REF.test(value)
      ? value
      : stop(
          `--pr takes fe#<n> (synbox) or be#<n> (synbox-transcribe-whisper), not "${value}".`
        )
  )

const findAsk = (ledger: Ledger, id: string | undefined) =>
  ledger.asks.find((ask) => ask.id === id) ??
  stop(`No ask "${id}". \`bun harness/asks.ts list --all\` shows every id.`)

// A deferred ask must say what holds it and what clears it, or nobody can tell when to pick it up again
const applyStatus = (ask: Ask, status: Status) => {
  const blocker =
    flags.blocker ?? (status === 'deferred' ? ask.blocker : undefined)
  const unblockedBy =
    flags['unblocked-by'] ??
    (status === 'deferred' ? ask.unblocked_by : undefined)
  if (
    status === 'deferred' &&
    ((blocker ?? '') === '' || (unblockedBy ?? '') === '')
  ) {
    stop(
      `A deferred ask needs --blocker "<what holds it>" and --unblocked-by <condition>. Conditions that ` +
        `\`cleared\` resurfaces: ${Object.keys(CONDITIONS).join(', ')}; any other text is cleared by hand.`
    )
  }
  if (status !== 'deferred' && ask.status === 'deferred') {
    ask.note = [
      ask.note,
      `was deferred: ${ask.blocker} (until ${ask.unblocked_by})`,
    ]
      .filter((part) => part !== undefined)
      .join('; ')
  }
  ask.status = status
  ask.blocker = status === 'deferred' ? blocker : undefined
  ask.unblocked_by = status === 'deferred' ? unblockedBy : undefined
}

const addLinks = (ask: Ask) => {
  ask.prs = [...new Set([...ask.prs, ...parsePrs(flags.pr)])]
  ask.logs = [...new Set([...ask.logs, ...(flags.log ?? [])])]
  if (flags.note !== undefined) {
    ask.note = flags.note
  }
}

const describe = (ask: Ask) => {
  const links = ask.prs.join(' ')
  const held =
    ask.status === 'deferred'
      ? ` | held: ${ask.blocker} | clears when: ${ask.unblocked_by}`
      : ''
  return `${ask.id} [${PROJECT_TAG[ask.project]}] ${oneLine(ask.quote, 100)}${links === '' ? '' : ` (${links})`}${held}`
}

const SECTIONS: { status: Status; title: string }[] = [
  { status: 'deferred', title: 'Deferred' },
  { status: 'in_progress', title: 'In progress' },
  { status: 'open', title: 'Open' },
  { status: 'done', title: 'Done' },
  { status: 'declined', title: 'Declined' },
]

const untriagedOf = (ledger: Ledger) =>
  inbox().filter((item) => !(item.key in ledger.triaged))

const commands: Record<string, () => void> = {
  cleared: () => {
    const condition =
      positionals[1] ?? stop('cleared <condition>: which condition came true?')
    const reopened = withLedger((ledger) => {
      const waiting = ledger.asks.filter(
        (ask) => ask.status === 'deferred' && ask.unblocked_by === condition
      )
      for (const ask of waiting) {
        applyStatus(ask, 'open')
        ask.updated = now()
      }
      return waiting
    })
    if (reopened.length === 0) {
      console.log(`Nothing was waiting on "${condition}".`)
      return
    }
    console.log(`Reopened, now that ${CONDITIONS[condition] ?? condition}:`)
    for (const ask of reopened) {
      console.log(`  ${describe(ask)}`)
    }
    console.log('Pick them up now, or tell the owner they are ready.')
  },

  import: () => {
    const transcript = positionals[1] ?? stop('import <transcript.jsonl>')
    if (!existsSync(transcript)) {
      stop(`No file ${transcript}.`)
    }
    const found = withLedger((ledger) =>
      sweep(ledger, [path.resolve(transcript)])
    )
    console.log(
      `${found} new message(s) in the inbox. Next: bun harness/asks.ts triage`
    )
  },

  link: () => {
    const [, id, ...keys] = positionals
    if (keys.length === 0) {
      stop('link <id> <key>...')
    }
    withLedger((ledger) => {
      const ask = findAsk(ledger, id)
      for (const key of keys) {
        ledger.triaged[key] = ask.id
        if (!ask.inbox.includes(key)) {
          ask.inbox.push(key)
        }
      }
      ask.updated = now()
    })
    console.log(`Linked ${keys.length} message(s) to ${id}.`)
  },

  list: () => {
    const ledger = readLedger()
    const project =
      flags.project === undefined ? undefined : parseProject(flags.project)
    const shown = flags.all ? SECTIONS : SECTIONS.slice(0, 3)
    for (const { status, title } of shown) {
      const asks = ledger.asks.filter(
        (ask) =>
          ask.status === status &&
          (project === undefined || ask.project === project)
      )
      if (asks.length === 0) {
        continue
      }
      console.log(`${title} (${asks.length})`)
      for (const ask of asks) {
        console.log(`  ${describe(ask)}`)
      }
    }
    const untriaged = untriagedOf(ledger).length
    if (untriaged > 0) {
      console.log(
        `\n${untriaged} untriaged message(s): bun harness/asks.ts triage`
      )
    }
  },

  new: () => {
    const quote =
      positionals[1] ??
      stop('new "<quote>": the ask in the owner\'s words, short.')
    if (quote.length > MAX_QUOTE) {
      stop(
        `Keep the quote under ${MAX_QUOTE} characters (it is ${quote.length}); the full text stays in the inbox.`
      )
    }
    const project = parseProject(flags.project)
    const status = parseStatus(flags.status, 'open')
    const id = withLedger((ledger) => {
      const items = inbox()
      const from = flags.from ?? []
      const first = items.find((item) => from.includes(item.key))
      for (const key of from) {
        if (!items.some((item) => item.key === key)) {
          stop(`No inbox message with key ${key}.`)
        }
      }
      const ask: Ask = {
        created: flags.created ?? first?.time ?? now(),
        id: `A${Math.max(0, ...ledger.asks.map((a) => Number(a.id.slice(1)))) + 1}`,
        inbox: from,
        logs: [],
        project,
        prs: [],
        quote,
        session: flags.session ?? first?.session_id ?? '',
        status: 'open',
        updated: now(),
      }
      applyStatus(ask, status)
      addLinks(ask)
      ledger.asks.push(ask)
      for (const key of from) {
        ledger.triaged[key] = ask.id
      }
      return ask.id
    })
    console.log(`${id} filed.`)
  },

  report: () => {
    const ledger = withLedger((l) => {
      sweep(l)
      return l
    })
    const by = (status: Status) =>
      ledger.asks.filter((ask) => ask.status === status)
    const untriaged = untriagedOf(ledger).length
    const counts = [
      `${by('deferred').length} deferred`,
      `${by('in_progress').length} in progress`,
      `${by('open').length} open`,
      ...(untriaged > 0
        ? [`${untriaged} untriaged (bun harness/asks.ts triage)`]
        : []),
    ]
    console.log(`Asks: ${counts.join(', ')}`)
    for (const { status, title } of SECTIONS.slice(0, 3)) {
      const asks = by(status)
      if (asks.length === 0) {
        continue
      }
      console.log(`${title}:`)
      for (const ask of asks) {
        console.log(`- ${describe(ask)}`)
      }
    }
    const steps = openOwnerSteps()
    if (steps.length > 0) {
      console.log(
        `Owner steps, for you to do (${steps.length} open; portal, where and what in docs/private/owner-steps.md):`
      )
      for (const step of steps) {
        console.log(`- ${step}`)
      }
    }
  },

  set: () => {
    const [, id, statusArg] = positionals
    if (!id || !statusArg) {
      stop(
        'set <id> <status> [--pr fe#N] [--log <file>] [--blocker "…" --unblocked-by <condition>]'
      )
    }
    const status = parseStatus(statusArg, 'open')
    const ask = withLedger((ledger) => {
      const found = findAsk(ledger, id)
      applyStatus(found, status)
      addLinks(found)
      if (flags.project !== undefined) {
        found.project = parseProject(flags.project)
      }
      found.updated = now()
      return found
    })
    console.log(describe(ask))
  },

  show: () => {
    const ledger = readLedger()
    const ask = findAsk(ledger, positionals[1])
    console.log(JSON.stringify(ask, null, 2))
    const items = inbox().filter((item) => ask.inbox.includes(item.key))
    for (const item of items) {
      console.log(`\n--- ${item.time} ${item.key}\n${item.prompt}`)
    }
  },

  skip: () => {
    const keys = positionals.slice(1)
    if (keys.length === 0) {
      stop('skip <key>...')
    }
    withLedger((ledger) => {
      for (const key of keys) {
        ledger.triaged[key] = 'skip'
      }
    })
    console.log(`Skipped ${keys.length} message(s).`)
  },

  triage: () => {
    const { found, untriaged } = withLedger((ledger) => ({
      found: sweep(ledger),
      untriaged: untriagedOf(ledger),
    }))
    if (found > 0) {
      console.log(`(${found} message(s) found in transcripts)`)
    }
    if (untriaged.length === 0) {
      console.log('Inbox triaged: nothing new.')
      return
    }
    console.log(`${untriaged.length} untriaged message(s), oldest first:\n`)
    for (const item of untriaged) {
      const more = item.truncated ? `, cut from ${item.chars} chars` : ''
      console.log(
        `${item.key}  ${item.time}  session ${item.session_id.slice(0, 8)}${more}`
      )
      console.log(`  ${oneLine(item.prompt, 300)}\n`)
    }
    console.log(
      [
        'File each one:',
        '  new "<the ask, owner\'s words>" --from <key> --project <frontend|backend|both|dev-process|other> [--status …]',
        '  link <id> <key>...     a follow-up to an ask already filed',
        '  skip <key>...          not an ask: a question answered in chat, a reply, a thanks',
        '`bun harness/asks.ts show <id>` prints an ask with its messages.',
      ].join('\n')
    )
  },
}

const name = positionals[0] ?? ''
try {
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined
  if (command === undefined) {
    stop(
      `Commands: ${Object.keys(commands).join(', ')}. See the top of harness/asks.ts.`
    )
  }
  command()
} catch (error) {
  if (!(error instanceof RefusalError)) {
    throw error
  }
  console.error(error.message)
  process.exitCode = 1
}
