// The bench's memory. It lives in the main checkout's gitignored `.harness/`, so every worktree reads and writes
// one history, and nothing measured here is ever committed.
//
//   .harness/bench/history.jsonl     one RunRecord per line, append-only
//   .harness/bench/runs/<run id>/    screenshots and traces of a run
//   .harness/bench/builds/<tree>/    bench builds, one per source tree
//   .harness/bench/fixtures/         recorded API responses, named by a hash of the request
//   .harness/verdicts/<tree>.json    what the PR gate hook reads (shared format across repos)

import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { isRecord, parseJson } from './json'
import type { BenchResult, Rect, RunRecord, Sample, Verdict } from './types'

const isRunRecord = (v: unknown): v is RunRecord =>
  isRecord(v) && v.schema === 'synbox-bench/run@1'

const isVerdict = (v: unknown): v is Verdict =>
  isRecord(v) && v.schema === 'harness/verdict@1'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim()

export interface Repo {
  top: string
  main: string
  sha: string
  tree: string
  branch: string
  /** Files changed against the merge base with origin/main, plus uncommitted ones */
  changed: string[]
  dirty: boolean
}

export const repoAt = (cwd: string, ref = 'HEAD'): Repo => {
  const top = git(cwd, 'rev-parse', '--show-toplevel')
  const main = path.dirname(
    git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  )
  const base = git(cwd, 'merge-base', ref, 'origin/main')
  const committed = git(cwd, 'diff', '--name-only', base, ref)
  const status = git(cwd, 'status', '--porcelain')
  const uncommitted = status
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3))
  return {
    branch: git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'),
    changed: [
      ...new Set([...committed.split('\n').filter(Boolean), ...uncommitted]),
    ],
    dirty: uncommitted.length > 0,
    main,
    sha: git(cwd, 'rev-parse', ref),
    top,
    tree: git(cwd, 'rev-parse', `${ref}^{tree}`),
  }
}

export const mergeBase = (cwd: string): string =>
  git(cwd, 'merge-base', 'HEAD', 'origin/main')

export const storeDir = (repo: Repo, ...parts: string[]): string => {
  const dir = path.join(repo.main, '.harness', ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

const historyFile = (repo: Repo) =>
  path.join(storeDir(repo, 'bench'), 'history.jsonl')

export const loadHistory = (repo: Repo): RunRecord[] => {
  const file = historyFile(repo)
  if (!existsSync(file)) {
    return []
  }
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => parseJson(line, isRunRecord, 'a history.jsonl line'))
}

export const appendRun = (repo: Repo, run: RunRecord): void => {
  appendFileSync(historyFile(repo), `${JSON.stringify(run)}\n`)
}

export interface Key {
  fingerprint: string
  conditions: string
}

const sameConditions = (r: RunRecord, key: Key) =>
  r.machine.fingerprint === key.fingerprint && r.conditions === key.conditions

const benchOf = (
  r: RunRecord,
  id: string,
  specHash: string
): BenchResult | undefined =>
  r.benches.find((b) => b.id === id && b.specHash === specHash)

const pool = (samples: Sample[]): Record<string, number[]> => {
  const out: Record<string, number[]> = {}
  for (const s of samples) {
    for (const [k, v] of Object.entries(s.values)) {
      if (Number.isFinite(v)) {
        ;(out[k] ??= []).push(v)
      }
    }
  }
  return out
}

/** Accepted runs kept in the rolling baseline; older ones age out, so a stale improvement can't pin it forever */
export const WINDOW = 3

export interface Pooled {
  values: Record<string, number[]>
  landmarks: Record<string, Rect> | null
  runs: string[]
}

/**
 * The rolling baseline for one benchmark: samples pooled from the last WINDOW accepted runs of the merge base's
 * tree, under the same machine, conditions and benchmark spec. Keyed by tree, not commit: a branch merged on top of
 * main produces exactly that tree, so its own passing gate run becomes the next baseline with no extra measuring.
 * Abandoned branches and reverted climb steps never match, and a main that moved is measured afresh instead of
 * being compared with an older one.
 */
export const baselineFor = (
  history: RunRecord[],
  id: string,
  specHash: string,
  key: Key,
  excludeTree: string,
  baseTree: string
): Pooled => {
  const runs = history
    .filter(
      (r) =>
        r.accepted &&
        r.git.tree !== excludeTree &&
        sameConditions(r, key) &&
        r.git.tree === baseTree
    )
    .filter((r) => benchOf(r, id, specHash))
    .slice(-WINDOW)
  const samples = runs.flatMap((r) => benchOf(r, id, specHash)?.samples ?? [])
  const latest = samples.findLast((s) => s.landmarks)
  return {
    landmarks: latest?.landmarks ?? null,
    runs: runs.map((r) => r.id),
    values: pool(samples),
  }
}

/**
 * Every sample ever taken of this tree under the same conditions. Re-running an unchanged tree adds samples to one
 * pool instead of buying a fresh draw, so a regression can't be re-rolled away (the AAR paper's commonest cheat).
 */
export const candidateFor = (
  history: RunRecord[],
  current: Sample[],
  id: string,
  specHash: string,
  key: Key,
  tree: string,
  role: RunRecord['role']
): Record<string, number[]> => {
  const earlier = history
    .filter(
      (r) => r.git.tree === tree && r.role === role && sameConditions(r, key)
    )
    .flatMap((r) => benchOf(r, id, specHash)?.samples ?? [])
  return pool([...earlier, ...current])
}

export const writeVerdict = (repo: Repo, verdict: Verdict): string => {
  const file = path.join(storeDir(repo, 'verdicts'), `${verdict.tree}.json`)
  writeFileSync(file, `${JSON.stringify(verdict, null, 2)}\n`)
  return file
}

export const readVerdict = (repo: Repo): Verdict | null => {
  const file = path.join(storeDir(repo, 'verdicts'), `${repo.tree}.json`)
  return existsSync(file)
    ? parseJson(readFileSync(file, 'utf-8'), isVerdict, file)
    : null
}
