// Where the bench keeps what it measures: the main checkout's gitignored `.harness/`, so every worktree shares one
// store and nothing measured is ever committed.
//
//   .harness/verdicts/<tree>.json    what `check` stamps; the PR hook and the release read it
//   .harness/bench/builds/<tree>/    production builds, one per source tree
//   .harness/bench/runs/<run id>/    screenshots, traces and reports of a run
//   .harness/bench/fixtures/         recorded API responses, named by a hash of the request
//   .harness/bench/trend-reference   the commit `trend` compares against
//   .harness/queue.md                findings waiting for a person (trend results)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { isRecord } from './json'
import type { Verdict } from './types'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim()

export interface Repo {
  top: string
  main: string
  sha: string
  tree: string
  branch: string
  dirty: boolean
}

export const repoAt = (cwd: string): Repo => {
  const top = git(cwd, 'rev-parse', '--show-toplevel')
  return {
    branch: git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git(cwd, 'status', '--porcelain') !== '',
    main: path.dirname(
      git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    ),
    sha: git(cwd, 'rev-parse', 'HEAD'),
    top,
    tree: git(cwd, 'rev-parse', 'HEAD^{tree}'),
  }
}

export const storeDir = (repo: Repo, ...parts: string[]): string => {
  const dir = path.join(repo.main, '.harness', ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

const isVerdict = (v: unknown): v is Verdict =>
  isRecord(v) && v.schema === 'harness/verdict@1' && v.kind === 'check'

export const writeVerdict = (repo: Repo, verdict: Verdict): string => {
  const file = path.join(storeDir(repo, 'verdicts'), `${verdict.tree}.json`)
  writeFileSync(file, `${JSON.stringify(verdict, null, 2)}\n`)
  return file
}

/** The check's verdict for `tree`; a verdict from the retired timing gate is not one */
export const readVerdict = (repo: Repo, tree = repo.tree): Verdict | null => {
  const file = path.join(storeDir(repo, 'verdicts'), `${tree}.json`)
  if (!existsSync(file)) {
    return null
  }
  const value: unknown = JSON.parse(readFileSync(file, 'utf-8'))
  return isVerdict(value) ? value : null
}
