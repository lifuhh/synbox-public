// Ship what is in `staging` to production, as one merge to main: one Netlify build for everything finished since
// the last release, from any session. The only way changes reach main (the PR hook blocks every other).
//
//   bun harness/release.ts --dry-run    what would ship; changes nothing
//   bun harness/release.ts --preview    a deploy preview of staging, smoke-tested, for a phone check; merges nothing
//   bun harness/release.ts              check staging's tree, smoke-test a local production build of it (no build
//                                       minutes), PR staging → main, a deploy preview smoke-tested, merge, wait for
//                                       live, smoke-test https://synbox.io: 2 Netlify builds
//   bun harness/release.ts --no-preview the same without the deploy preview, once the local smoke passed: 1 build
//
// Netlify build minutes are scarce: the local smoke (harness/local-site.ts, Netlify's own runtime on this machine)
// runs first, so a broken staging stops the release with no build spent.
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
const PREVIEW_TIMEOUT_MS = 15 * 60_000
// The commit status Netlify posts for a pull request's deploy preview
const PREVIEW_STATUS = /^netlify\/[^/]+\/deploy-preview$/u
// A ready preview's link: https://deploy-preview-<pr>--<site>.netlify.app
const PREVIEW_URL = /^https:\/\/deploy-preview-\d+--[^/]+\.netlify\.app\/?$/u
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
    'no-preview': { type: 'boolean' },
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

const isStatus = (
  v: unknown
): v is {
  context: string
  state: string
  target_url: string | null
  description?: string | null
} => isRecord(v) && typeof v.context === 'string' && typeof v.state === 'string'

/** The deploy preview Netlify builds for `sha`, once ready; stops the release when its build fails */
const waitForPreview = (sha: string): string => {
  const deadline = Date.now() + PREVIEW_TIMEOUT_MS
  while (Date.now() < deadline) {
    const statuses: unknown = JSON.parse(
      gh('api', `repos/{owner}/{repo}/commits/${sha}/statuses`)
    )
    // Newest first: the build's latest word
    const latest: unknown = Array.isArray(statuses)
      ? statuses.find(
          (s: unknown) => isStatus(s) && PREVIEW_STATUS.test(s.context)
        )
      : undefined
    if (isStatus(latest) && latest.state === 'success') {
      // A canceled build also posts success, with the Netlify dashboard as its link: it happens when a PR merges
      // into staging during the release, so the [preview] commit is no longer the head Netlify builds
      if (latest.target_url !== null && PREVIEW_URL.test(latest.target_url)) {
        return latest.target_url
      }
      throw new Error(
        `Netlify posted "${String(latest.description)}" for the deploy preview, not a preview site: staging probably moved during the release (a PR merged into it). Nothing was merged; release again`
      )
    }
    if (
      isStatus(latest) &&
      (latest.state === 'failure' || latest.state === 'error')
    ) {
      throw new Error(
        `the deploy preview of staging failed to build (${latest.target_url ?? 'no log link'}). Reproduce it locally with \`bunx netlify-cli build --offline --context deploy-preview\` in a copy of staging, fix it in a PR into staging, then release again`
      )
    }
    spawnSync('sleep', [String(LIVE_POLL_MS / 1000)])
  }
  throw new Error(
    `no deploy preview after ${PREVIEW_TIMEOUT_MS / 60_000} minutes; check the Netlify deploy log`
  )
}

/** `harness/smoke.ts` from staging's tree (the evaluator that ships), against a deployed copy */
const smoke = (dir: string, url: string): boolean => {
  say(`smoke: ${url}`)
  return (
    spawnSync('bun', ['harness/smoke.ts', url], { cwd: dir, stdio: 'inherit' })
      .status === 0
  )
}

/** `harness/smoke.ts --local` from staging's tree: a production build served by Netlify's runtime here, no build minutes */
const smokeLocal = (dir: string): boolean => {
  say(
    "smoke: a local production build of staging (Netlify's runtime on this machine; no Netlify build)"
  )
  return (
    spawnSync('bun', ['harness/smoke.ts', '--local'], {
      cwd: dir,
      stdio: 'inherit',
    }).status === 0
  )
}

/** Builds a deploy preview of staging's tip (a [preview] commit) and smoke-tests it; false when the smoke fails */
const smokePreview = (dir: string, number: string): boolean => {
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
  const sha = run('git', ['-C', dir, 'rev-parse', 'HEAD'], dir)
  say(`preview: building #${number} at ${sha.slice(0, 8)} (a few minutes)`)
  const url = waitForPreview(sha)
  say(`preview: ${url}`)
  return smoke(dir, url)
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

/** The local smoke, before anything is built on Netlify; says how many builds the rest will spend */
const smokeBeforeBuilding = (dir: string) => {
  if (flags.preview === true && flags['no-preview'] === true) {
    throw new Error(
      '--preview and --no-preview ask for opposite things; pick one'
    )
  }
  if (!smokeLocal(dir)) {
    throw new Error(
      'smoke FAIL on a local production build of staging: no PR opened, no Netlify build spent. Fix it in a PR into staging, then release again'
    )
  }
  if (flags.preview === true) {
    say('builds: 1 (the deploy preview); nothing is merged')
  } else if (flags['no-preview'] === true) {
    say(
      'builds: 1 (main only: --no-preview; the local smoke stands in for the preview)'
    )
  } else {
    say('builds: 2 (the deploy preview, then main)')
  }
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
    say(
      'smoke: a release smoke-tests a local production build of staging first (no build minutes), then a deploy preview (1 Netlify build; skipped with --no-preview), then the live site after the merge (1 build)'
    )
    return
  }
  smokeBeforeBuilding(dir)
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
  const smoked = flags['no-preview'] === true || smokePreview(dir, number)
  if (flags.preview === true) {
    say(
      smoked
        ? 'preview: smoke PASS; run without --preview to ship'
        : 'preview: smoke FAIL (above); fix it in a PR into staging before shipping'
    )
    if (!smoked) {
      process.exitCode = 1
    }
    return
  }
  if (!smoked) {
    throw new Error(
      `smoke FAIL on the deploy preview of #${number}: nothing was merged. Fix it in a PR into staging, then release again`
    )
  }
  gh('pr', 'merge', number, '--merge')
  git('fetch', '--quiet', 'origin')
  const sha = git('rev-parse', 'origin/main')
  say(`merged #${number} into main (${sha.slice(0, 8)})`)
  waitForLive(sha)
  run('git', ['-C', dir, 'checkout', '--quiet', '--detach', sha], dir)
  if (!smoke(dir, SITE)) {
    process.exitCode = 1
    say(
      [
        '',
        '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
        `!!  smoke FAIL on ${SITE}: the release is LIVE and something is broken`,
        '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
        'The failing lines are above, the report beside them. To roll back now:',
        '  1. Netlify › synbox › Deploys: open the previous production deploy, press "Publish deploy" (instant, no build).',
        `  2. Then fix forward: a PR into staging (git revert -m 1 ${sha.slice(0, 8)} reverts the whole release), and release again.`,
        'A failure the preview did not show is usually live data or a backend difference: compare the two reports.',
      ].join('\n')
    )
  }
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
