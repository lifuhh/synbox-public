// Ship what is in `staging` to production, as one merge to main: one Netlify build for everything finished since
// the last release, from any session. The only way changes reach main (the PR hook blocks every other).
//
//   bun harness/release.ts --dry-run    what would ship; changes nothing
//   bun harness/release.ts --preview    a deploy preview of staging for a phone check; merges nothing
//   bun harness/release.ts              check staging's tree, PR staging → main, merge, wait for live
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

/**
 * Runs `check` on staging's tree, every release: the combined tree is what ships, and each PR's own verdict judged
 * a different tree. Skipped only when nothing it checks differs from main.
 */
const checkStaging = (dir: string) => {
  const changed = git('diff', '--name-only', 'origin/main', `origin/${STAGING}`)
    .split('\n')
    .filter(Boolean)
  const paths = gatePaths(dir)
  if (
    !changed.some((file) => paths.some((p) => file === p || file.startsWith(p)))
  ) {
    say('check: staging changes nothing it checks')
    return
  }
  const repo = repoAt(dir)
  if (flags['dry-run'] === true) {
    say(`check: a release runs it on staging's tree ${repo.tree.slice(0, 8)}`)
    return
  }
  say('check: running on staging')
  const result = spawnSync('bun', ['harness/bench/cli.ts', 'check'], {
    cwd: dir,
    stdio: 'inherit',
  })
  const verdict = readVerdict(repo)
  if (result.status !== 0 || verdict === null || verdict.status !== 'pass') {
    throw new Error(
      `check: ${verdict?.summary ?? 'no verdict'}. Fix it in a PR into staging, then release again`
    )
  }
  say(`check: pass in ${Math.round(verdict.wallMs / 1000)}s`)
}

// A page's text, or '' when the request fails: mid-deploy, Netlify can drop a connection, which is a reason to
// look again, not to give up
const fetchText = (url: string): string => {
  const result = spawnSync('curl', ['-s', '--max-time', '20', url], {
    encoding: 'utf-8',
  })
  return result.status === 0 ? result.stdout : ''
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
    const page = fetchText(`${SITE}/`)
    const script = /\/assets\/index-[^"]*\.js/u.exec(page)?.[0]
    if (script !== undefined && fetchText(`${SITE}${script}`).includes(sha)) {
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
  checkStaging(dir)
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
