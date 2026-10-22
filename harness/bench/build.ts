// Production builds for the bench, one per source tree and cached, so a tree is only ever built once. The lookup
// service is pointed at the bench server (/__lookup) so its reads are recorded and replayed like /api.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'

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

const vpBuild = (srcDir: string, outDir: string) =>
  run('bunx', ['vp', 'build', '--outDir', outDir, '--emptyOutDir'], srcDir, {
    VITE_SYNBOX_LOOKUP_URL: '/__lookup',
  })

/** Builds the working tree as it is (uncommitted edits included), keyed by HEAD's tree plus a dirty marker */
export const buildWorkingTree = (
  repo: Repo,
  log: (m: string) => void
): string => {
  const out = path.join(
    storeDir(repo, 'bench', 'builds'),
    repo.dirty ? `${repo.tree}-dirty` : repo.tree
  )
  if (repo.dirty || !existsSync(path.join(out, 'index.html'))) {
    log(
      `building ${repo.dirty ? 'working tree (uncommitted changes)' : repo.tree.slice(0, 8)}`
    )
    vpBuild(repo.top, out)
  }
  return out
}

/** Builds another commit (the merge base, for a baseline) in a throwaway worktree */
export const buildRef = (
  repo: Repo,
  sha: string,
  log: (m: string) => void
): { dist: string; tree: string } => {
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
    log(`building ${sha.slice(0, 8)} (baseline)`)
    vpBuild(wt, out)
  } finally {
    run('git', ['-C', repo.top, 'worktree', 'remove', '--force', wt], repo.top)
  }
  return { dist: out, tree }
}
