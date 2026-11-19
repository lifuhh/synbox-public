// A second opinion on design: the taste checker (upstream taste-skill, a pinned copy shared by every repo on this
// machine) run over every page the layout audits visit, keeping only the checks harness/taste/checks.json adopts or
// adapts for that kind of page, less the findings harness/taste/baseline.json accepts. Read-only: nothing it does
// writes to the app's services, and nothing lands outside the run's own .reports/ folder and the OS temp folder.
//
//   bun harness/taste.ts fetch                        verify the shared copy; download it when missing
//   bun harness/taste.ts scan [page] [--width 1440|390] [--site <origin>]
//                                                     every page (or one, by name or path) at 1440 and 390 wide
//   bun harness/taste.ts copy [page] [--site <origin>]
//                                                     the copy linter on About, What's New, Privacy, Terms, the shell
//   bun harness/taste.ts compare <base> [<head>]      two scans by page and check: what was added, what is gone.
//                                                     Each is a findings.json or a git ref (its newest scan in .reports/);
//                                                     <head> defaults to this checkout's newest scan. Exits 3 when added
//
// Without --site, this checkout's production build is served the way `smoke.ts --local` serves it
// (harness/local-site.ts); --site takes one already served (`bun harness/local-site.ts`). The checker opens the page
// in its own headless, muted Chrome (`--headless=new --mute-audio`), one page at a time, niced. It sees Chromium at
// rest only: the layout audits in `check` stay the authority for WebKit, the installed app and opened states.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { closeBrowsers, open, WEB } from './bench/engines/browser'
import { isRecord, parseJson } from './bench/json'
import { layoutPages } from './bench/probes/layout'
import { repoAt } from './bench/store'
import type { Repo } from './bench/store'
import { serveLocalSite } from './local-site'
import {
  diffScans,
  isBaseline,
  isChecks,
  judge,
  kindOf,
  parseReport,
} from './taste/findings'
import type {
  BaselineEntry,
  Checks,
  Finding,
  Judgement,
  Kind,
} from './taste/findings'

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: 'string' },
    width: { type: 'string' },
  },
})

const WIDTHS = [1440, 390]
// The slowest page (the player) took about 95 s at both widths in the trial; past this the run is stuck
const PAGE_TIMEOUT_MS = 8 * 60_000
const MIN_NODE = 22

const log = (m: string): void => {
  process.stderr.write(`· ${m}\n`)
}

const HERE = import.meta.dirname
const checks = parseJson(
  readFileSync(path.join(HERE, 'taste/checks.json'), 'utf-8'),
  isChecks,
  'harness/taste/checks.json'
)
const baseline: BaselineEntry[] = parseJson(
  readFileSync(path.join(HERE, 'taste/baseline.json'), 'utf-8'),
  isBaseline,
  'harness/taste/baseline.json'
).entries

// ---- The shared copy ----

/** One folder per version, outside every skills folder, so no agent loads the skill by itself */
const checkerDir = (c: Checks): string =>
  path.join(
    homedir(),
    '.agents',
    'vendor',
    `${c.checker.name}-${c.checker.version}`
  )

/** SKILL.md's frontmatter, between its first two `---` lines */
const frontmatter = (md: string): string =>
  /^---\n(?<fm>[\s\S]*?)\n---/u.exec(md)?.groups?.fm ?? ''

/** SKILL.md without the `hooks:` block in its frontmatter (a Stop hook that would run the skill's gate) */
const withoutHooks = (md: string): string => {
  const fm = frontmatter(md)
  const kept: string[] = []
  let inHooks = false
  for (const line of fm.split('\n')) {
    if (line.startsWith('hooks:')) {
      inHooks = true
    } else if (!(inHooks && (/^\s/u.test(line) || line === ''))) {
      inHooks = false
      kept.push(line)
    }
  }
  return md.replace(fm, kept.join('\n'))
}

const nodeMajor = (): number =>
  Number(
    /^v(?<major>\d+)/u.exec(
      execFileSync('node', ['--version'], { encoding: 'utf-8' })
    )?.groups?.major ?? 0
  )

/** What is wrong with the shared copy, or null when it is the pinned one */
const checkerProblem = (c: Checks, dir: string): string | null => {
  const pin = path.join(dir, '.pin')
  if (!existsSync(pin)) {
    return `${dir} has no .pin`
  }
  const pinned = readFileSync(pin, 'utf-8').trim()
  if (pinned !== c.checker.sha) {
    return `${dir} is pinned to ${pinned}, harness/taste/checks.json to ${c.checker.sha}`
  }
  for (const script of ['consistency.mjs', 'copy-lint.mjs']) {
    if (!existsSync(path.join(dir, 'scripts', script))) {
      return `${dir} has no scripts/${script}`
    }
  }
  const skill = path.join(dir, 'SKILL.md')
  if (
    existsSync(skill) &&
    /^hooks:/mu.test(frontmatter(readFileSync(skill, 'utf-8')))
  ) {
    return `${dir}/SKILL.md still declares hooks`
  }
  return null
}

interface Checker {
  dir: string
  consistency: string
  copyLint: string
}

/** The pinned copy, or an error that says how to get it: never a scan without it */
const requireChecker = (): Checker => {
  const dir = checkerDir(checks)
  const problem = existsSync(dir)
    ? checkerProblem(checks, dir)
    : `${dir} is missing`
  if (problem !== null) {
    throw new Error(`${problem}: run \`bun harness/taste.ts fetch\``)
  }
  if (nodeMajor() < MIN_NODE) {
    throw new Error(`the checker needs Node ${MIN_NODE}+`)
  }
  return {
    consistency: path.join(dir, 'scripts', 'consistency.mjs'),
    copyLint: path.join(dir, 'scripts', 'copy-lint.mjs'),
    dir,
  }
}

const fetchChecker = (): void => {
  const dir = checkerDir(checks)
  const { repo, sha, folder } = checks.checker
  if (existsSync(dir)) {
    const problem = checkerProblem(checks, dir)
    if (problem === null) {
      process.stdout.write(`taste: ${dir} is ${sha}\n`)
      return
    }
    // Shared with other repos: replacing it here would change what their scans measure
    throw new Error(
      `${problem}. The copy is shared, so it is never overwritten: a version bump is a new folder name (a new \`checker.version\` in harness/taste/checks.json)`
    )
  }
  const work = mkdtempSync(path.join(tmpdir(), 'synbox-taste-fetch-'))
  // Staged beside the target and renamed into place, so a failed download never leaves a half copy
  const stage = `${dir}.partial-${process.pid}`
  try {
    const tarball = path.join(work, 'source.tar.gz')
    execFileSync('curl', [
      '-sfL',
      `https://codeload.github.com/${repo}/tar.gz/${sha}`,
      '-o',
      tarball,
    ])
    const root = `${repo.split('/')[1]}-${sha}`
    mkdirSync(stage, { recursive: true })
    execFileSync('tar', [
      '-xzf',
      tarball,
      '-C',
      stage,
      `--strip-components=${folder.split('/').length + 1}`,
      `${root}/${folder}`,
    ])
    execFileSync('tar', [
      '-xzf',
      tarball,
      '-C',
      stage,
      '--strip-components=1',
      `${root}/LICENSE`,
    ])
    const skill = path.join(stage, 'SKILL.md')
    writeFileSync(skill, withoutHooks(readFileSync(skill, 'utf-8')))
    writeFileSync(path.join(stage, '.pin'), `${sha}\n`)
    renameSync(stage, dir)
  } finally {
    rmSync(work, { force: true, recursive: true })
    rmSync(stage, { force: true, recursive: true })
  }
  const problem = checkerProblem(checks, dir)
  if (problem !== null) {
    throw new Error(`fetched, but ${problem}`)
  }
  process.stdout.write(`taste: fetched ${sha} into ${dir}\n`)
}

// ---- The site under review ----

interface Site {
  origin: string
  /** Writes the guard answered in place, by method and path */
  answered: string[]
  stop: () => void
}

/**
 * The site behind a guard: reads pass through, and every write (a listen, usage events) is answered here and never
 * reaches the live services, as `engines/browser.ts` › `open` does for the bench's browsers. The checker's Chrome is
 * its own, so the guard sits in front of the site instead of in the browser
 */
const guarded = (upstream: string, stopUpstream: () => void): Site => {
  const answered: string[] = []
  const server = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url)
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        answered.push(`${request.method} ${url.pathname}`)
        return url.pathname.endsWith('/listen')
          ? Response.json({ ok: true })
          : new Response(null, { status: 204 })
      }
      const headers = new Headers(request.headers)
      headers.delete('connection')
      return await fetch(`${upstream}${url.pathname}${url.search}`, {
        decompress: false,
        headers,
        method: request.method,
        redirect: 'manual',
      })
    },
    idleTimeout: 120,
    port: 0,
  })
  return {
    answered,
    origin: `http://localhost:${server.port}`,
    stop: () => {
      void server.stop(true)
      stopUpstream()
    },
  }
}

const serveSite = async (repo: Repo): Promise<Site> => {
  if (flags.site !== undefined) {
    return guarded(new URL(flags.site).origin, () => {
      // not ours to stop
    })
  }
  // The scan's own page loads report nothing to the error tracker: an empty DSN leaves the SDK off
  // (src/instrument.ts), and a variable already set wins over the env file in the build
  process.env.VITE_SENTRY_DSN = ''
  log('building and serving this checkout (harness/local-site.ts)')
  const site = await serveLocalSite(repo.top)
  return guarded(site.url, site.stop)
}

// ---- Pages ----

interface ScanPage {
  name: string
  route: string
  /** Path and query the checker opens */
  path: string
  kind: Kind
}

/**
 * Every page the layout audits visit (LAYOUT_PAGES, routes.json samples, routes without parameters), once per URL.
 * Not a page that needs the lab's seeds (`setup`: a stored playlist, an admin session): the checker's own browser
 * can't be given them, and would judge a Not Found or Forbidden page instead
 */
const scanPages = (): ScanPage[] => {
  const seen = new Set<string>()
  return layoutPages().flatMap((p) => {
    if (p.path.includes(':') || p.setup !== undefined || seen.has(p.path)) {
      return []
    }
    seen.add(p.path)
    return [
      {
        kind: kindOf(checks, p.route),
        name: p.name,
        path: p.path,
        route: p.route,
      },
    ]
  })
}

const pick = <T extends { name: string }>(
  all: T[],
  wanted: string | undefined,
  matches: (p: T, w: string) => boolean
): T[] => {
  if (wanted === undefined) {
    return all
  }
  const found = all.filter((p) => matches(p, wanted))
  if (found.length === 0) {
    throw new Error(
      `no page "${wanted}"; pages: ${all.map((p) => p.name).join(', ')}`
    )
  }
  return found
}

/** `.reports/YYYY-MM-DD-taste-<slug>`, numbered when that day's folder is taken */
const runDir = (repo: Repo, slug: string): string => {
  const day = new Date().toLocaleDateString('en-CA')
  const base = path.join(repo.top, '.reports', `${day}-taste-${slug}`)
  let dir = base
  for (let n = 2; existsSync(dir); n += 1) {
    dir = `${base}-${n}`
  }
  mkdirSync(dir, { recursive: true })
  return dir
}

// ---- One page through the checker ----

const children = new Set<number>()
process.once('exit', () => {
  for (const pid of children) {
    try {
      // The whole group: node and its Chrome
      process.kill(-pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
})

/** The environment the checker gets: nothing that makes it share state outside this run */
const checkerEnv = (): NodeJS.ProcessEnv => {
  const {
    TASTE_SKILL_RECENT: _recent,
    TASTE_SKILL_TMP: _tmp,
    ...env
  } = process.env
  return env
}

interface PageRun {
  exit: number | null
  seconds: number
  error?: string
}

const runChecker = async (
  checker: Checker,
  url: string,
  widths: number[],
  out: string
): Promise<PageRun> => {
  mkdirSync(out, { recursive: true })
  const profile = mkdtempSync(path.join(tmpdir(), 'synbox-taste-chrome-'))
  const stdout = openSync(path.join(out, 'checker.txt'), 'w')
  const stderr = openSync(path.join(out, 'checker-errors.txt'), 'w')
  const started = Date.now()
  const args = [
    '-n',
    '19',
    'node',
    checker.consistency,
    url,
    '--widths',
    widths.join(','),
    '--page',
    'software',
    '--out',
    out,
    '--profile',
    profile,
    ...checks.flags.filter((f) => f.use).map((f) => f.flag),
  ]
  // cwd is the run's folder: a path the checker falls back to (`.taste-skill/`) lands there, never in the repo
  const child = spawn('nice', args, {
    cwd: out,
    detached: true,
    env: checkerEnv(),
    stdio: ['ignore', stdout, stderr],
  })
  if (child.pid !== undefined) {
    children.add(child.pid)
  }
  const { promise, resolve } = Promise.withResolvers<number | null>()
  const timer = setTimeout(() => {
    if (child.pid !== undefined) {
      process.kill(-child.pid, 'SIGTERM')
    }
  }, PAGE_TIMEOUT_MS)
  child.once('exit', (code) => {
    resolve(code)
  })
  child.once('error', () => {
    resolve(null)
  })
  const exit = await promise
  clearTimeout(timer)
  if (child.pid !== undefined) {
    children.delete(child.pid)
  }
  closeSync(stdout)
  closeSync(stderr)
  rmSync(profile, { force: true, recursive: true })
  const seconds = Math.round((Date.now() - started) / 1000)
  if (exit === null) {
    return {
      error: `stopped after ${PAGE_TIMEOUT_MS / 60_000} min or failed to start`,
      exit,
      seconds,
    }
  }
  return { exit, seconds }
}

// ---- scan ----

interface PageResult extends ScanPage, PageRun {
  notCheckedAt: number[]
  kept: number
  baselined: number
  dropped: Record<'rejected' | 'out-of-scope' | 'unknown', number>
  unknownIds: string[]
}

interface Scan {
  schema: 'synbox/taste-scan@1'
  checker: { name: string; version: string; sha: string }
  commit: string
  dirty: boolean
  at: string
  widths: number[]
  pages: PageResult[]
  findings: Finding[]
}

const isScan = (v: unknown): v is Scan =>
  isRecord(v) &&
  v.schema === 'synbox/taste-scan@1' &&
  typeof v.commit === 'string' &&
  typeof v.at === 'string' &&
  Array.isArray(v.widths) &&
  Array.isArray(v.pages) &&
  Array.isArray(v.findings)

const pad = (s: string | number, n: number): string => String(s).padEnd(n)

const printScan = (scan: Scan): void => {
  const out: string[] = [
    `\n${pad('page', 13)}${pad('kind', 8)}${pad('adopt', 7)}${pad('adapt', 7)}${pad('baselined', 11)}${pad('dropped', 9)}status`,
  ]
  for (const p of scan.pages) {
    const mine = scan.findings.filter((f) => f.page === p.name)
    const dropped = Object.values(p.dropped).reduce((a, b) => a + b, 0)
    const status =
      p.error ??
      (p.exit === 2 || p.notCheckedAt.length > 0
        ? `NOT CHECKED${p.notCheckedAt.length > 0 ? ` at ${p.notCheckedAt.join(', ')}px` : ''}`
        : 'checked')
    out.push(
      `${pad(p.name, 13)}${pad(p.kind, 8)}${pad(mine.filter((f) => f.verdict === 'adopt').length, 7)}${pad(mine.filter((f) => f.verdict === 'adapt').length, 7)}${pad(p.baselined, 11)}${pad(dropped, 9)}${status} (${p.seconds}s)`
    )
  }
  out.push('')
  for (const p of scan.pages) {
    const counts = new Map<
      string,
      { verdict: string; fail: number; warn: number }
    >()
    for (const f of scan.findings.filter((x) => x.page === p.name)) {
      const c = counts.get(f.id) ?? { fail: 0, verdict: f.verdict, warn: 0 }
      counts.set(f.id, {
        ...c,
        fail: c.fail + (f.level === 'FAIL' ? 1 : 0),
        warn: c.warn + (f.level === 'WARN' ? 1 : 0),
      })
    }
    const rows = [...counts]
      .toSorted(([, a], [, b]) => b.fail + b.warn - (a.fail + a.warn))
      .map(
        ([id, c]) =>
          `${id} (${c.verdict}) ${[c.fail > 0 ? `${c.fail} FAIL` : '', c.warn > 0 ? `${c.warn} WARN` : ''].filter(Boolean).join(' ')}`
      )
    out.push(`${p.name}: ${rows.join(', ') || 'nothing kept'}`)
    if (p.unknownIds.length > 0) {
      out.push(
        `  not in harness/taste/checks.json (dropped): ${p.unknownIds.join(', ')}`
      )
    }
  }
  process.stdout.write(`${out.join('\n')}\n`)
}

const scan = async (repo: Repo): Promise<void> => {
  const checker = requireChecker()
  const widths = flags.width === undefined ? WIDTHS : [Number(flags.width)]
  if (!widths.every((w) => WIDTHS.includes(w))) {
    throw new Error(`--width takes ${WIDTHS.join(' or ')}`)
  }
  const pages = pick(
    scanPages(),
    positionals[1],
    (p, w) => p.name === w || p.path === w || p.route === w
  )
  const slug = `${positionals[1] === undefined ? 'all' : pages[0].name}${flags.width === undefined ? '' : `-${flags.width}`}`
  const dir = runDir(repo, slug)
  const site = await serveSite(repo)
  const results: PageResult[] = []
  const findings: Finding[] = []
  const strayBefore = existsSync(path.join(repo.top, '.taste-skill'))
  try {
    for (const page of pages) {
      log(`${page.name}: ${page.path}`)
      const out = path.join(dir, page.name)
      // oxlint-disable-next-line eslint/no-await-in-loop -- one Chrome at a time
      const run = await runChecker(
        checker,
        `${site.origin}${page.path}`,
        widths,
        out
      )
      const reportFile = path.join(out, 'report.json')
      const report = existsSync(reportFile)
        ? parseReport(JSON.parse(readFileSync(reportFile, 'utf-8')))
        : { findings: [], notCheckedAt: widths }
      const result: PageResult = {
        ...page,
        ...run,
        baselined: 0,
        dropped: { 'out-of-scope': 0, rejected: 0, unknown: 0 },
        kept: 0,
        notCheckedAt: report.notCheckedAt,
        unknownIds: [],
      }
      for (const raw of report.findings) {
        const verdict: Judgement = judge(checks, baseline, page, raw)
        if (verdict.kept) {
          result.kept += 1
          findings.push({
            ...raw,
            crop: raw.crop === null ? null : `${page.name}/${raw.crop}`,
            page: page.name,
            verdict: verdict.verdict,
          })
        } else if (verdict.why === 'baselined') {
          result.baselined += 1
        } else {
          result.dropped[verdict.why] += 1
          if (
            verdict.why === 'unknown' &&
            !result.unknownIds.includes(raw.id)
          ) {
            result.unknownIds.push(raw.id)
          }
        }
      }
      results.push(result)
      log(
        `${page.name}: ${result.kept} kept, ${result.baselined} baselined, exit ${run.exit} in ${run.seconds}s`
      )
    }
  } finally {
    site.stop()
  }
  const result: Scan = {
    at: new Date().toISOString(),
    checker: {
      name: checks.checker.name,
      sha: checks.checker.sha,
      version: checks.checker.version,
    },
    commit: repo.sha,
    dirty: repo.dirty,
    findings,
    pages: results,
    schema: 'synbox/taste-scan@1',
    widths,
  }
  const file = path.join(dir, 'findings.json')
  writeFileSync(file, `${JSON.stringify(result, null, 1)}\n`)
  printScan(result)
  if (site.answered.length > 0) {
    process.stdout.write(
      `writes answered in place (never sent): ${site.answered.length} (${[...new Set(site.answered)].join(', ')})\n`
    )
  }
  if (!strayBefore && existsSync(path.join(repo.top, '.taste-skill'))) {
    process.stdout.write(
      `WARNING: the checker wrote ${path.join(repo.top, '.taste-skill')}; delete it and report the path\n`
    )
  }
  process.stdout.write(`\n${file}\n`)
  process.exitCode = results.some(
    (p) => p.error !== undefined || p.exit === 2 || p.notCheckedAt.length > 0
  )
    ? 2
    : 0
}

// ---- copy ----

interface CopyPage {
  name: string
  route: string
}

const copyPages = (): CopyPage[] => [
  ...Object.entries(checks.pageKinds)
    .filter(([, kind]) => kind === 'prose')
    .map(([route]) => ({ name: route.slice(1), route })),
  // The shell: index.html as served, its title, description and the text before the app draws
  { name: 'shell', route: '' },
]

const isCopyLint = (
  v: unknown
): v is {
  files: {
    file: string
    words: number
    findings: {
      sev: string
      id: string
      count: number
      msg: string
      examples: string[]
    }[]
  }[]
} =>
  isRecord(v) &&
  Array.isArray(v.files) &&
  v.files.every((f) => isRecord(f) && Array.isArray(f.findings))

const copy = async (repo: Repo): Promise<void> => {
  const checker = requireChecker()
  const pages = pick(
    copyPages(),
    positionals[1],
    (p, w) => p.name === w || p.route === w
  )
  const dir = runDir(
    repo,
    `copy${positionals[1] === undefined ? '' : `-${pages[0].name}`}`
  )
  const site = await serveSite(repo)
  const files: string[] = []
  try {
    const rendered = pages.filter((p) => p.route !== '')
    if (rendered.length > 0) {
      const { page, close } = await open(WEB.surface, {
        serviceWorkers: 'block',
      })
      try {
        for (const p of rendered) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- one tab, page by page
          await page.goto(`${site.origin}${p.route}`, { waitUntil: 'load' })
          // oxlint-disable-next-line eslint/no-await-in-loop -- one tab, page by page
          await page.waitForFunction(
            () =>
              document.querySelector('main h1') !== null &&
              document.querySelector('[aria-busy=true]') === null,
            null,
            { timeout: 20_000 }
          )
          const file = path.join(dir, `${p.name}.html`)
          // oxlint-disable-next-line eslint/no-await-in-loop -- one tab, page by page
          writeFileSync(file, await page.content())
          files.push(file)
        }
      } finally {
        await close()
      }
    }
    if (pages.some((p) => p.route === '')) {
      const file = path.join(dir, 'shell.html')
      const shell = await fetch(`${site.origin}/`)
      writeFileSync(file, await shell.text())
      files.push(file)
    }
  } finally {
    site.stop()
    await closeBrowsers()
  }
  // Exit 1 is a FAIL in a file; 2 is a file it could not read
  const run = spawnSync('node', [checker.copyLint, ...files, '--json'], {
    encoding: 'utf-8',
    env: checkerEnv(),
  })
  if (run.status !== 0 && run.status !== 1) {
    throw new Error(`copy-lint exited ${run.status}: ${run.stderr.trim()}`)
  }
  const lint = run.stdout
  writeFileSync(path.join(dir, 'copy-lint.json'), lint)
  const result = parseJson(lint, isCopyLint, 'copy-lint --json')
  const out: string[] = []
  for (const f of result.files) {
    const shown = f.findings.filter((x) => x.sev !== 'INFO')
    out.push(
      `\n${path.basename(f.file, '.html')} (${f.words} words): ${shown.length === 0 ? 'no FAIL or WARN' : ''}`
    )
    for (const x of f.findings) {
      out.push(
        `  ${pad(x.sev, 5)}${pad(x.id, 24)}${x.msg}${x.examples.length > 0 ? `\n${' '.repeat(29)}e.g. ${x.examples.map((e) => `"${e}"`).join(', ')}` : ''}`
      )
    }
  }
  process.stdout.write(
    `${out.join('\n')}\n\n${path.join(dir, 'copy-lint.json')}\n`
  )
}

// ---- compare ----

/** Every scan in this checkout's and the main checkout's .reports/, newest first */
const scans = (repo: Repo): { file: string; scan: Scan }[] =>
  [...new Set([repo.top, repo.main])]
    .map((top) => path.join(top, '.reports'))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => /-taste-/u.test(name))
        .map((name) => path.join(dir, name, 'findings.json'))
        .filter((file) => existsSync(file))
    )
    .flatMap((file) => {
      const v: unknown = JSON.parse(readFileSync(file, 'utf-8'))
      return isScan(v) ? [{ file, scan: v }] : []
    })
    .toSorted((a, b) => b.scan.at.localeCompare(a.scan.at))

const loadScan = (repo: Repo, what: string): { file: string; scan: Scan } => {
  if (what.endsWith('.json')) {
    return {
      file: what,
      scan: parseJson(readFileSync(what, 'utf-8'), isScan, what),
    }
  }
  const sha = execFileSync(
    'git',
    ['-C', repo.top, 'rev-parse', `${what}^{commit}`],
    {
      encoding: 'utf-8',
    }
  ).trim()
  const found = scans(repo).find((s) => s.scan.commit === sha && !s.scan.dirty)
  if (found === undefined) {
    throw new Error(
      `no scan of ${what} (${sha.slice(0, 9)}) in .reports/: run \`bun harness/taste.ts scan\` in a clean checkout of it, or pass a findings.json`
    )
  }
  return found
}

/** Pages a scan walked at every width */
const checkedPages = (s: Scan): Set<string> =>
  new Set(
    s.pages
      .filter((p) => p.notCheckedAt.length === 0 && p.error === undefined)
      .map((p) => p.name)
  )

const findingLine = (sign: string, f: Finding): string =>
  `${sign} ${f.page} [${f.width}] ${f.level} ${f.id}  ${f.selector}${f.text === '' ? '' : `  "${f.text.slice(0, 40)}"`}`

const compare = (repo: Repo): void => {
  const [, baseArg, headArg] = positionals
  if (baseArg === undefined) {
    throw new Error('usage: bun harness/taste.ts compare <base> [<head>]')
  }
  const base = loadScan(repo, baseArg)
  const head =
    headArg === undefined
      ? scans(repo).find((s) => s.file.startsWith(repo.top))
      : loadScan(repo, headArg)
  if (head === undefined) {
    throw new Error(
      "no scan in this checkout's .reports/: run `bun harness/taste.ts scan` first"
    )
  }
  // Only what both scans looked at: a page or width one of them skipped would read as all added or all gone
  const widths = head.scan.widths.join(',')
  if (base.scan.widths.join(',') !== widths) {
    throw new Error(
      `the scans walked different widths (${base.scan.widths.join(',')} and ${widths}): compare scans made with the same --width`
    )
  }
  const basePages = checkedPages(base.scan)
  const both = [...checkedPages(head.scan)].filter((p) => basePages.has(p))
  const within = (f: Finding) => both.includes(f.page)
  const { added, gone } = diffScans(
    base.scan.findings.filter(within),
    head.scan.findings.filter(within)
  )
  const out = [
    `base ${base.file} (${base.scan.commit.slice(0, 9)})`,
    `head ${head.file} (${head.scan.commit.slice(0, 9)}${head.scan.dirty ? ', uncommitted changes' : ''})`,
    `pages checked in both: ${both.join(', ') || 'none'}; widths ${widths}`,
    '',
    `${pad('page', 13)}${pad('check', 18)}${pad('base', 6)}${pad('head', 6)}`,
  ]
  const ids = new Map<string, [number, number]>()
  for (const [i, list] of [base.scan.findings, head.scan.findings].entries()) {
    for (const f of list.filter(within)) {
      const key = `${f.page}\u0000${f.id}`
      const c = ids.get(key) ?? [0, 0]
      c[i] += 1
      ids.set(key, c)
    }
  }
  for (const [key, [before, after]] of [...ids].toSorted(([x], [y]) =>
    x.localeCompare(y)
  )) {
    if (before !== after) {
      const [page, id] = key.split('\u0000')
      out.push(
        `${pad(page, 13)}${pad(id, 18)}${pad(before, 6)}${pad(after, 6)}`
      )
    }
  }
  out.push(
    '',
    `added ${added.length}, gone ${gone.length}`,
    ...added.map((f) => findingLine('+', f)),
    ...gone.map((f) => findingLine('-', f))
  )
  process.stdout.write(`${out.join('\n')}\n`)
  process.exitCode = added.length > 0 ? 3 : 0
}

// ---- main ----

const main = async () => {
  const repo = repoAt(process.cwd())
  switch (positionals[0]) {
    case 'fetch': {
      fetchChecker()
      return
    }
    case 'scan': {
      await scan(repo)
      return
    }
    case 'copy': {
      await copy(repo)
      return
    }
    case 'compare': {
      compare(repo)
      return
    }
    default: {
      throw new Error(
        'usage: bun harness/taste.ts fetch | scan [page] [--width 1440|390] [--site <origin>] | copy [page] [--site <origin>] | compare <base> [<head>]'
      )
    }
  }
}

try {
  await main()
} catch (error) {
  process.stderr.write(
    `taste: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
}
