// One measuring run per machine. Two runs at once each read the other's load as their own slowness: on 2026-10-22 a
// stale gate kept measuring beside another session's for minutes. The lock lives in the main checkout's .harness/,
// so every worktree of the repo shares it; a run waits for the holder, and a holder that died leaves nothing behind
// that counts.

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { isRecord } from './json'
import { storeDir } from './store'
import type { Repo } from './store'

const WAIT_MS = 45 * 60_000
const POLL_MS = 15_000

interface Holder {
  pid: number
  what: string
  at: string
}

const isHolder = (v: unknown): v is Holder =>
  isRecord(v) &&
  typeof v.pid === 'number' &&
  typeof v.what === 'string' &&
  typeof v.at === 'string'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const holderOf = (file: string): Holder | null => {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    return isHolder(value) && alive(value.pid) ? value : null
  } catch {
    return null
  }
}

// Takes the machine for `what` (e.g. "gate"), waiting while another live run holds it. Returns the release; it also
// runs when the process exits
export const holdMachine = async (
  repo: Repo,
  what: string,
  log: (message: string) => void
): Promise<() => void> => {
  const file = path.join(storeDir(repo, 'bench'), 'machine.lock.json')
  const deadline = Date.now() + WAIT_MS
  let told = false
  for (;;) {
    const holder = holderOf(file)
    if (holder === null) {
      // A dead holder's file is stale: clear it, then create ours only if no other run got there first. Two runs
      // clearing the same stale file at once could each delete the other's new one, so ours counts only once it
      // reads back as ours
      rmSync(file, { force: true })
      try {
        writeFileSync(
          file,
          JSON.stringify({
            at: new Date().toISOString(),
            pid: process.pid,
            what,
          }),
          { flag: 'wx' }
        )
      } catch {
        continue
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- a beat for a racing run's delete to land
      await Bun.sleep(200)
      if (holderOf(file)?.pid === process.pid) {
        break
      }
      continue
    }
    if (Date.now() > deadline) {
      throw new Error(
        `another bench run (${holder.what}, pid ${holder.pid}, since ${holder.at}) still holds the machine after ${WAIT_MS / 60_000} minutes`
      )
    }
    if (!told) {
      log(
        `waiting: another bench run (${holder.what}, pid ${holder.pid}, since ${holder.at}) is measuring on this machine`
      )
      told = true
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- waiting is the point
    await Bun.sleep(POLL_MS)
  }
  const release = () => {
    if (holderOf(file)?.pid === process.pid) {
      rmSync(file, { force: true })
    }
  }
  process.on('exit', release)
  return release
}
