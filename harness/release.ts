// Ship what is in `staging` to production, as one merge to main: one Netlify build for everything finished since
// the last release, from any session. The only way changes reach main (the PR hook blocks every other).
//
//   bun harness/release.ts --dry-run    what would ship, and whether its gate verdict exists; changes nothing
//   bun harness/release.ts --preview    a deploy preview of staging for a phone check; merges nothing
//   bun harness/release.ts              gate (if staging's tree has no verdict), PR staging → main, merge, wait for live
//
// One release at a time on this machine: a lock in the main checkout's .harness/ names the process holding it.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { isRecord, parseJson } from './bench/json'
import { readVerdict, repoAt, storeDir } from './bench/store'

const STAGING = 'staging'
const SITE = 'https://synbox.io'
const LIVE_TIMEOUT_MS = 15 * 60_000
const LIVE_POLL_MS = 20_000
// Files a production build never reads; scripts/netlify-ignore.sh skips the build when only these change
const NOT_APP = [
  ':(exclude)docs',
  ':(exclude)harness',
  ':(exclude)scripts',
  ':(exclude)*.md',
  ':(exclude).claude',
]

const { values: flags } = parseArgs({
  options: {
    'dry-run': { type: 'boolean' },
    preview: { type: 'boolean' },
  },
})

const run = (
  cmd: string,
  args: string[],
  cwd: string,
  inherit = false
): string => {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    stdio: inherit ? 'inherit' : 'pipe',
  })
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed: ${(result.stderr ?? '').trim().slice(0, 400)}`
    )
  }
  return (result.stdout ?? '').trim()
}

const say = (message: string) => {
  console.log(message)
}

const here = repoAt(process.cwd())
const top = here.main
const git = (...args: string[]) => run('git', ['-C', top, ...args], top)
const gh = (...args: string[]) => run('gh', args, top)

const isLock = (v: unknown): v is { pid: number; at: string } =>
  isRecord(v) && typeof v.pid === 'number' && typeof v.at === 'string'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const lockFile = path.join(storeDir(here, 'release'), 'lock.json')
const takeLock = () => {
  if (existsSync(lockFile)) {
    const lock = parseJson(readFileSync(lockFile, 'utf-8'), isLock, lockFile)
    if (alive(lock.pid)) {
      throw new Error(
        `a release is already running (pid ${lock.pid}, since ${lock.at}); wait for it`
      )
    }
  }
  writeFileSync(
    lockFile,
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid })
  )
}

// The PRs merged into staging since the last release, newest first, from staging's merge commits
const contents = (): { number: string; title: string }[] =>
  git(
    'log',
    '--merges',
    '--first-parent',
    '--format=%s',
    `origin/main..origin/${STAGING}`
  )
    .split('\n')
    .flatMap((subject) => {
      const number = /Merge pull request #(?<n>\d+)/u.exec(subject)?.groups?.n
      return number === undefined
        ? []
        : [
            {
              number,
              title: gh(
                'pr',
                'view',
                number,
                '--json',
                'title',
                '-q',
                '.title'
              ),
            },
          ]
    })

// A worktree on staging's tip, beside the main checkout, reused between releases
const stagingWorktree = (): string => {
  const dir = path.join(path.dirname(top), `${path.basename(top)}-release`)
  if (existsSync(dir)) {
    run(
      'git',
      ['-C', dir, 'checkout', '--quiet', '--detach', `origin/${STAGING}`],
      dir
    )
  } else {
    git('worktree', 'add', '--quiet', '--detach', dir, `origin/${STAGING}`)
  }
  run('bun', ['install', '--frozen-lockfile'], dir)
  return dir
}

// From staging's own gate.json: the main checkout's working tree may be on any branch
const gatePaths = (dir: string): string[] => {
  const config: unknown = JSON.parse(
    readFileSync(path.join(dir, 'harness', 'gate.json'), 'utf-8')
  )
  return isRecord(config) && Array.isArray(config.paths)
    ? config.paths.filter((p) => typeof p === 'string')
    : []
}

const isVerdict = (v: unknown): v is { status: string; summary: string } =>
  isRecord(v) &&
  v.schema === 'harness/verdict@1' &&
  typeof v.status === 'string'

// The verdict that covers staging: its own tree's, or that of the newest commit before it (first parent) after
// which nothing the gate measures changed. So merging harness or docs work on top of a gated tree needs no
// second gate run; any measured change does
const coveringVerdict = (dir: string, paths: string[]) => {
  const inDir = (...args: string[]) => run('git', ['-C', dir, ...args], dir)
  for (const sha of inDir(
    'rev-list',
    '--first-parent',
    '--max-count=50',
    'HEAD'
  ).split('\n')) {
    const tree = inDir('rev-parse', `${sha}^{tree}`)
    const file = path.join(storeDir(here, 'verdicts'), `${tree}.json`)
    if (existsSync(file)) {
      const measured = inDir('diff', '--name-only', sha, 'HEAD')
        .split('\n')
        .filter(Boolean)
        .filter((f) => paths.some((p) => f === p || f.startsWith(p)))
      return measured.length === 0
        ? {
            from: sha,
            verdict: parseJson(readFileSync(file, 'utf-8'), isVerdict, file),
          }
        : null
    }
  }
  return null
}

// The gate's verdict for staging, running the gate first when no verdict covers it
const ensureVerdict = (dir: string) => {
  const changed = git('diff', '--name-only', 'origin/main', `origin/${STAGING}`)
    .split('\n')
    .filter(Boolean)
  const paths = gatePaths(dir)
  if (
    !changed.some((file) => paths.some((p) => file === p || file.startsWith(p)))
  ) {
    say('gate: staging changes nothing the gate measures')
    return
  }
  const covering = coveringVerdict(dir, paths)
  let verdict = covering?.verdict ?? null
  if (covering !== null) {
    say(
      `gate: reusing the verdict for ${covering.from.slice(0, 8)}; nothing it measures changed since`
    )
  }
  if (verdict === null) {
    const repo = repoAt(dir)
    if (flags['dry-run'] === true) {
      say(
        `gate: no verdict covers staging's tree ${repo.tree.slice(0, 8)}; a release runs it (about 8 minutes)`
      )
      return
    }
    say('gate: running on staging (keep the machine idle)')
    run('bun', ['harness/bench/cli.ts', 'gate'], dir, true)
    verdict = readVerdict(repo)
  }
  if (verdict === null || verdict.status === 'fail') {
    throw new Error(
      `gate: ${verdict?.summary ?? 'no verdict'}. Fix staging (or waive with a reason) before releasing`
    )
  }
  say(
    `gate: ${verdict.status}${verdict.summary === '' ? '' : ` (${verdict.summary})`}`
  )
}

const waitForLive = (sha: string) => {
  const appChanged = run(
    'git',
    ['-C', top, 'diff', '--name-only', `${sha}^1`, sha, '--', '.', ...NOT_APP],
    top
  )
  if (appChanged === '') {
    say('live: nothing the site builds from changed; Netlify skips this build')
    return
  }
  const deadline = Date.now() + LIVE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const page = run('curl', ['-s', `${SITE}/`], top)
    const script = /\/assets\/index-[^"]*\.js/u.exec(page)?.[0]
    if (
      script !== undefined &&
      run('curl', ['-s', `${SITE}${script}`], top).includes(sha)
    ) {
      say(`live: ${SITE} serves ${sha.slice(0, 8)}`)
      return
    }
    spawnSync('sleep', [String(LIVE_POLL_MS / 1000)])
  }
  throw new Error(
    `not live after ${LIVE_TIMEOUT_MS / 60_000} minutes; check the Netlify deploy log`
  )
}

const release = () => {
  git('fetch', '--quiet', 'origin')
  const ahead = git('rev-list', '--count', `origin/main..origin/${STAGING}`)
  if (ahead === '0') {
    say('Nothing in staging to ship.')
    return
  }
  const shipping = contents()
  say(`staging is ${ahead} commit(s) ahead of main:`)
  for (const pr of shipping) {
    say(`  #${pr.number} ${pr.title}`)
  }
  const dir = stagingWorktree()
  ensureVerdict(dir)
  if (flags['dry-run'] === true) {
    return
  }
  const open = gh(
    'pr',
    'list',
    '--head',
    STAGING,
    '--base',
    'main',
    '--state',
    'open',
    '--json',
    'number',
    '-q',
    '.[0].number'
  )
  const body = [
    'Ships everything merged into staging since the last release:',
    '',
    ...shipping.map((pr) => `- #${pr.number} ${pr.title}`),
  ].join('\n')
  const number =
    open === ''
      ? (/\/pull\/(?<n>\d+)/u.exec(
          gh(
            'pr',
            'create',
            '--base',
            'main',
            '--head',
            STAGING,
            '--title',
            `Release ${new Date().toISOString().slice(0, 10)}`,
            '--body',
            body
          )
        )?.groups?.n ?? '')
      : open
  if (flags.preview === true) {
    run(
      'git',
      [
        '-C',
        dir,
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        'Build a preview [preview]',
      ],
      dir
    )
    run('git', ['-C', dir, 'push', '--quiet', 'origin', `HEAD:${STAGING}`], dir)
    say(
      `preview: https://deploy-preview-${number}--synbox.netlify.app (ready in a few minutes); run without --preview to ship`
    )
    return
  }
  gh('pr', 'merge', number, '--merge')
  git('fetch', '--quiet', 'origin')
  const sha = git('rev-parse', 'origin/main')
  say(`merged #${number} into main (${sha.slice(0, 8)})`)
  waitForLive(sha)
}

try {
  takeLock()
  release()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  rmSync(lockFile, { force: true })
}
