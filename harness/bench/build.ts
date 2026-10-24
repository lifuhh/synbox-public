// Production builds for the bench, one per source tree and cached, so a tree is only ever built once. The lookup
// service is pointed at the bench server (/__lookup) so its reads are recorded and replayed like /api.

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { storeDir } from './store'
import type { Repo } from './store'

const run = (
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
) =>
  execFileSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

// Asynchronous, so `check` can run the static checks beside it
const vpBuild = async (srcDir: string, outDir: string): Promise<void> => {
  // oxlint-disable-next-line typescript/strict-void-return -- promisify takes Node's callback-style execFile; the ChildProcess it returns goes unused
  await promisify(execFile)(
    'bunx',
    ['vp', 'build', '--outDir', outDir, '--emptyOutDir'],
    {
      cwd: srcDir,
      // The lookup service and the Worker's lyrics routes (the site calls both directly, not through /api) go through
      // the bench server, so their reads are recorded and replayed like the rest (server.ts › proxiesFrom)
      env: {
        ...process.env,
        VITE_SYNBOX_API_URL: '/__api',
        VITE_SYNBOX_LOOKUP_URL: '/__lookup',
      },
      maxBuffer: 64 * 1024 * 1024,
    }
  )
}

/** Builds the working tree as it is (uncommitted edits included), keyed by HEAD's tree plus a dirty marker */
export const buildWorkingTree = async (
  repo: Repo,
  log: (m: string) => void
): Promise<string> => {
  const out = path.join(
    storeDir(repo, 'bench', 'builds'),
    repo.dirty ? `${repo.tree}-dirty` : repo.tree
  )
  if (repo.dirty || !existsSync(path.join(out, 'index.html'))) {
    log(
      `building ${repo.dirty ? 'working tree (uncommitted changes)' : repo.tree.slice(0, 8)}`
    )
    await vpBuild(repo.top, out)
  }
  return out
}

/** Builds another commit (a side of a `trend` comparison) in a throwaway worktree */
export const buildRef = async (
  repo: Repo,
  sha: string,
  log: (m: string) => void
): Promise<{ dist: string; tree: string }> => {
  const tree = execFileSync(
    'git',
    ['-C', repo.top, 'rev-parse', `${sha}^{tree}`],
    { encoding: 'utf-8' }
  ).trim()
  const out = path.join(storeDir(repo, 'bench', 'builds'), tree)
  if (existsSync(path.join(out, 'index.html'))) {
    return { dist: out, tree }
  }
  const wt = path.join(storeDir(repo, 'bench', 'worktrees'), tree.slice(0, 12))
  rmSync(wt, { force: true, recursive: true })
  run('git', ['-C', repo.top, 'worktree', 'add', '--detach', wt, sha], repo.top)
  try {
    const samePackages =
      readFileSync(path.join(wt, 'package.json'), 'utf-8') ===
      readFileSync(path.join(repo.top, 'package.json'), 'utf-8')
    if (samePackages) {
      symlinkSync(
        path.join(repo.top, 'node_modules'),
        path.join(wt, 'node_modules')
      )
    } else {
      log(`installing packages for ${sha.slice(0, 8)}`)
      run('bun', ['install', '--frozen-lockfile'], wt)
    }
    log(`building ${sha.slice(0, 8)}`)
    await vpBuild(wt, out)
  } finally {
    run('git', ['-C', repo.top, 'worktree', 'remove', '--force', wt], repo.top)
  }
  return { dist: out, tree }
}
