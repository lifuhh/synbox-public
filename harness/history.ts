// The app's history from both repos' change logs: this repo's docs/log and the backend's (synbox-transcribe-whisper,
// a sibling of the main checkout; SYNBOX_BACKEND_LOG overrides). Every entry's front matter carries `features:`,
// slugs from docs/log/FEATURES.md, so one feature reads from its first milestone to today.
//
//   bun harness/history.ts timeline [--since YYYY-MM-DD] [--feature <slug>]   every entry, oldest first
//   bun harness/history.ts features                                           the feature list, with entry counts and span
//   bun harness/history.ts feature <slug> [--core]                            one feature's evolution; --core adds Core changes
//   bun harness/history.ts html [--out <file>]                                the timeline and every feature as one page
//   bun harness/history.ts check                                              every entry tagged with known slugs (exits 1 if not)

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

interface Entry {
  body: string
  core: string[]
  date: string
  features: string[]
  file: string
  headline: string
  kind: string
  /** The PR: front matter `pr:` in older entries, else the merge commit of the entry's `branch:` */
  pr: number | null
  repo: 'be' | 'fe'
}

interface Feature {
  covers: string
  now: string
  slug: string
}

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: {
    core: { default: false, type: 'boolean' },
    feature: { type: 'string' },
    out: { type: 'string' },
    since: { type: 'string' },
  },
})

const frontendLog = path.resolve(import.meta.dir, '..', 'docs', 'log')

const mainCheckout = () =>
  path.dirname(
    spawnSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: import.meta.dir,
        encoding: 'utf-8',
      }
    ).stdout.trim()
  )

const backendLog =
  process.env.SYNBOX_BACKEND_LOG ??
  path.join(
    path.dirname(mainCheckout()),
    'synbox-transcribe-whisper',
    'docs',
    'log'
  )

// The front matter is flat `key: value` lines; lists are `[a, b]`; `#` starts a comment
const frontMatter = (text: string) => {
  const block =
    /^---\n(?<block>[\s\S]*?)\n---\n/u.exec(text)?.groups?.block ?? ''
  const out = new Map<string, string>()
  for (const line of block.split('\n')) {
    const kv = /^(?<key>[a-z_]+):\s*(?<value>.*)$/u.exec(line)?.groups
    if (kv?.key !== undefined && kv.value !== undefined) {
      out.set(kv.key, kv.value.replace(/\s+#.*$/u, '').trim())
    }
  }
  return out
}

const list = (value: string | undefined) =>
  (value ?? '')
    .replaceAll(/^\[|\]$/gu, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const coreChanges = (body: string) => {
  const at = body.search(/\*\*Core changes\*\*/u)
  if (at < 0) {
    return []
  }
  const out: string[] = []
  for (const line of body.slice(at).split('\n').slice(1)) {
    if (/^\s*[-*] /u.test(line)) {
      out.push(line.replace(/^\s*[-*] /u, '').trim())
    } else if (out.length > 0 && /^\s+\S/u.test(line)) {
      out[out.length - 1] += ` ${line.trim()}`
    } else if (line.trim() !== '' && out.length > 0) {
      break
    }
  }
  return out
}

/**
 * Each branch's merges in the log's repo, from GitHub's merge commit subjects ("Merge pull request #N from
 * owner/branch"), so an entry needs no commit after its PR is opened just to record the number
 */
const mergesOf = (dir: string): Map<string, { date: string; pr: number }[]> => {
  const out = new Map<string, { date: string; pr: number }[]>()
  const log = spawnSync(
    'git',
    ['-C', dir, 'log', '--all', '--merges', '--format=%cs%x09%s'],
    { encoding: 'utf-8' }
  ).stdout
  for (const line of log.split('\n')) {
    const m =
      /^(?<date>\S+)\tMerge pull request #(?<pr>\d+) from [^/\s]+\/(?<branch>\S+)/u.exec(
        line
      )?.groups
    if (m?.branch !== undefined && m.date !== undefined && m.pr !== undefined) {
      out.set(m.branch, [
        ...(out.get(m.branch) ?? []),
        { date: m.date, pr: Number(m.pr) },
      ])
    }
  }
  return out
}

/** The PR that merged `branch`: the first merge on or after the entry's date (a branch name can be reused) */
const prOf = (
  merges: Map<string, { date: string; pr: number }[]>,
  branch: string | undefined,
  date: string
): number | null => {
  const found = (branch === undefined ? [] : (merges.get(branch) ?? []))
    .filter((m) => m.date >= date)
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.pr - b.pr)
  return found[0]?.pr ?? null
}

const readLog = (dir: string, repo: Entry['repo']): Entry[] => {
  if (!existsSync(dir)) {
    console.error(`no log at ${dir}`)
    return []
  }
  const merges = mergesOf(dir)
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}-.+\.md$/u.test(name))
    .map((name) => {
      const text = readFileSync(path.join(dir, name), 'utf-8')
      const meta = frontMatter(text)
      const body = text.replace(/^---\n[\s\S]*?\n---\n/u, '')
      return {
        body,
        core: coreChanges(body),
        date: name.slice(0, 10),
        features: list(meta.get('features')),
        file: path.join(dir, name),
        headline: /^# (?<h>.+)$/mu.exec(body)?.groups?.h?.trim() ?? name,
        kind: meta.get('kind') ?? '?',
        pr: /^[1-9]\d*$/u.test(meta.get('pr') ?? '')
          ? Number(meta.get('pr'))
          : prOf(merges, meta.get('branch'), name.slice(0, 10)),
        repo,
      }
    })
}

const readFeatures = (): Feature[] => {
  const text = readFileSync(path.join(frontendLog, 'FEATURES.md'), 'utf-8')
  const now = new Map<string, string>()
  for (const section of text.split(/^## /mu).slice(1)) {
    const slug = /^`(?<slug>[a-z-]+)`/u.exec(section)?.groups?.slug
    if (slug !== undefined) {
      now.set(slug, section.split('\n').slice(1).join('\n').trim())
    }
  }
  return [
    ...text.matchAll(/^\| `(?<slug>[a-z-]+)` \| (?<covers>.+?) \|$/gmu),
  ].map((m) => {
    const slug = m.groups?.slug ?? ''
    return { covers: m.groups?.covers ?? '', now: now.get(slug) ?? '', slug }
  })
}

const entries = [
  ...readLog(frontendLog, 'fe'),
  ...readLog(backendLog, 'be'),
].toSorted(
  (a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file)
)
const features = readFeatures()
const known = new Set(features.map((f) => f.slug))

const prTag = (e: Entry) => (e.pr === null ? '' : `${e.repo}#${e.pr}`)

const row = (e: Entry) =>
  `${e.date}  ${prTag(e).padEnd(7)}  ${e.kind.padEnd(9)}  ${e.headline}`

const ESCAPES: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}
const escape = (s: string) => s.replaceAll(/["&<>]/gu, (c) => ESCAPES[c] ?? c)

const item = (e: Entry) =>
  `<li><time>${e.date}</time><span class="tag">${e.pr === null ? e.repo : prTag(e)} · ${escape(e.kind)}</span>${escape(e.headline)}` +
  `<span class="feat">${e.features.map(escape).join(' · ')}</span></li>`

const html = () => {
  const sections = features.map((f) => {
    const own = entries.filter((e) => e.features.includes(f.slug))
    return (
      `<section id="${f.slug}"><h2>${f.slug}</h2><p class="covers">${escape(f.covers)}</p>` +
      `<p class="now">${escape(f.now)}</p><ol>${own.map(item).join('')}</ol></section>`
    )
  })
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Synbox History</title><style>
:root{color-scheme:dark;--bg:#111014;--fg:#e8e6ea;--muted:#9a96a0;--line:#2a2830;--accent:#d9468f}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px}
nav{display:flex;flex-wrap:wrap;gap:6px 12px;margin:12px 0 32px}
a{color:var(--accent)}
h2{margin:40px 0 4px;font-size:20px}
.covers{color:var(--muted);margin:0 0 8px}
.now{margin:0 0 12px}
ol{list-style:none;padding:0;margin:0;border-left:1px solid var(--line)}
li{padding:4px 0 4px 14px}
time{color:var(--muted);font-variant-numeric:tabular-nums;margin-right:10px}
.tag{color:var(--muted);font-size:12px;margin-right:10px}
.feat{display:block;color:var(--muted);font-size:12px}
</style></head><body><main><h1>Synbox History</h1>
<p>${entries.length} entries from both repos, ${entries[0]?.date ?? ''} to ${entries.at(-1)?.date ?? ''}. Generated by <code>bun harness/history.ts html</code>.</p>
<nav>${features.map((f) => `<a href="#${f.slug}">${f.slug}</a>`).join('')}<a href="#timeline">timeline</a></nav>
${sections.join('\n')}
<section id="timeline"><h2>timeline</h2><ol>${entries.map(item).join('')}</ol></section>
</main></body></html>`
}

const [command] = positionals

if (command === 'timeline') {
  for (const e of entries) {
    const tooEarly = flags.since !== undefined && e.date < flags.since
    const otherFeature =
      flags.feature !== undefined && !e.features.includes(flags.feature)
    if (!tooEarly && !otherFeature) {
      console.log(row(e))
    }
  }
} else if (command === 'features') {
  for (const f of features) {
    const own = entries.filter((e) => e.features.includes(f.slug))
    const span = `${own[0]?.date ?? '-'} → ${own.at(-1)?.date ?? '-'}`
    console.log(
      `${f.slug.padEnd(16)} ${String(own.length).padStart(3)}  ${span}  ${f.covers}`
    )
  }
} else if (command === 'feature') {
  const f = features.find((x) => x.slug === positionals[1])
  if (f === undefined) {
    console.error(
      `unknown feature: ${positionals[1] ?? '(none)'}; see \`bun harness/history.ts features\``
    )
    process.exit(1)
  }
  console.log(`${f.slug}: ${f.covers}\n\nNow: ${f.now || '(not written)'}\n`)
  for (const e of entries.filter((x) => x.features.includes(f.slug))) {
    console.log(row(e))
    if (flags.core) {
      for (const c of e.core) {
        console.log(`              ${c}`)
      }
    }
  }
} else if (command === 'html') {
  const out = path.resolve(
    flags.out ?? path.join(mainCheckout(), '.reports', 'history', 'index.html')
  )
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, html())
  console.log(out)
} else if (command === 'check') {
  const bad = entries.filter(
    (e) => e.features.length === 0 || e.features.some((s) => !known.has(s))
  )
  for (const e of bad) {
    console.log(
      `${path.relative(process.cwd(), e.file)}: features [${e.features.join(', ')}]`
    )
  }
  console.log(
    bad.length > 0
      ? `${bad.length} of ${entries.length} entries untagged or using unknown slugs`
      : `${entries.length} entries ok`
  )
  process.exit(bad.length > 0 ? 1 : 0)
} else {
  console.error(
    'usage: bun harness/history.ts timeline | features | feature <slug> [--core] | html [--out <file>] | check'
  )
  process.exit(1)
}
