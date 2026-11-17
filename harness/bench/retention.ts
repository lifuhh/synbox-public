// What the bench keeps on disk. Every check writes a run folder (about 150 MB of screenshots and frames) and every
// tree a build; nothing removed them, and by 2026-11-17 the main checkout held 1,390 runs and 1,166 builds, 81 GB.
// A run is read while its failure is being worked out and a build while its tree is being checked, so both go after
// a few days. A build in use stays: buildWorkingTree touches the one it serves

import { readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

import { storeDir } from './store'
import type { Repo } from './store'

export const KEEP_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

/** Removes the folders in `dir` last changed more than `days` ago; returns how many went */
export const pruneOlderThan = (
  dir: string,
  days: number,
  now = Date.now()
): number => {
  let removed = 0
  for (const name of readdirSync(dir)) {
    const entry = path.join(dir, name)
    if (now - statSync(entry).mtimeMs > days * DAY_MS) {
      rmSync(entry, { force: true, recursive: true })
      removed += 1
    }
  }
  return removed
}

/** Run before a check starts; says what it removed, nothing when nothing was old */
export const pruneBenchStore = (repo: Repo, log: (m: string) => void) => {
  const runs = pruneOlderThan(storeDir(repo, 'bench', 'runs'), KEEP_DAYS)
  const builds = pruneOlderThan(storeDir(repo, 'bench', 'builds'), KEEP_DAYS)
  if (runs + builds > 0) {
    log(
      `removed ${runs} run folder(s) and ${builds} build(s) older than ${KEEP_DAYS} days`
    )
  }
}
