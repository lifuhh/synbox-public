// Sharing the machine between sessions' bench runs. Two kinds of work:
//
// - Timing work (`trend`, and `check`'s audits marked `timing`, which sample over time) needs the machine to itself:
//   another run's browsers would be part of what it measures. `holdMachine` takes the one exclusive lock, then
//   waits for every other run's browser audits to finish.
// - Every other audit (layout, presses, keyboard, boxes) measures nothing in time, so audits from several sessions
//   run at once, up to SLOTS browser audits machine-wide (`holdSlot`). They wait only while timing work holds the
//   machine.
//
// Both live in the main checkout's .harness/bench/, shared by every worktree. A holder that died leaves nothing
// that counts: each file names its process, and a file whose process is gone is ignored.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { isRecord } from './json'
import { storeDir } from './store'
import type { Repo } from './store'

const WAIT_MS = 45 * 60_000
const POLL_MS = 1000

/**
 * Browser audits at once on this machine, across every session. Measured on the M4 Pro (14 cores, 24 GB) on
 * 2026-10-27, with other sessions keeping the load at 45-85: the same 34 layout audits took 30 s three at a time,
 * 18 s six and 15 s eight, each audit's median flat at 2.0 s; nine took 19 s and twelve 22 s, the median up to
 * 3.1 s. Three (the first setting) left a scoped check waiting 195 s for a slot while other sessions' checks ran
 */
export const SLOTS = 8

/** An audit holds a slot for seconds (its own limit is minutes); an older slot is a reused process id, not a holder */
const SLOT_STALE_MS = 10 * 60_000

/**
 * `check` before scoped checks held the exclusive lock for its whole run under this name. Its audits never needed
 * it, so new audits don't wait for one; timing work still does
 */
const WHOLE_RUN = 'check'

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

const read = (file: string): Holder | null => {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    return isHolder(value) ? value : null
  } catch {
    return null
  }
}

const holderOf = (file: string): Holder | null => {
  const h = read(file)
  return h !== null && alive(h.pid) ? h : null
}

const lockFile = (repo: Repo) =>
  path.join(storeDir(repo, 'bench'), 'machine.lock.json')

const slotDir = (repo: Repo) => {
  const dir = path.join(storeDir(repo, 'bench'), 'slots')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Slots held by live processes, oldest first; files of processes that are gone are removed */
const liveSlots = (dir: string): { name: string; holder: Holder }[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      const holder = read(path.join(dir, name))
      if (holder === null) {
        return []
      }
      if (!alive(holder.pid)) {
        rmSync(path.join(dir, name), { force: true })
        return []
      }
      return Date.now() - Date.parse(holder.at) < SLOT_STALE_MS
        ? [{ holder, name }]
        : []
    })
    .toSorted(
      (a, b) =>
        a.holder.at.localeCompare(b.holder.at) || a.name.localeCompare(b.name)
    )

const now = () => new Date().toISOString()

const mine = new Set<string>()
process.on('exit', () => {
  for (const file of mine) {
    rmSync(file, { force: true })
  }
})

/**
 * Takes the machine for timing work `what` (e.g. "trend"): the exclusive lock, once no other live run holds it, then
 * a wait until no other process has a browser audit running. Returns the release; it also runs when the process
 * exits
 */
export const holdMachine = async (
  repo: Repo,
  what: string,
  log: (message: string) => void
): Promise<() => void> => {
  const file = lockFile(repo)
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
          JSON.stringify({ at: now(), pid: process.pid, what }),
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
    await Bun.sleep(POLL_MS * 5)
  }
  const release = () => {
    if (holderOf(file)?.pid === process.pid) {
      rmSync(file, { force: true })
    }
  }
  process.on('exit', release)
  // New audits now wait; the ones already running finish first
  const dir = slotDir(repo)
  let toldDrain = false
  for (;;) {
    const others = liveSlots(dir).filter((s) => s.holder.pid !== process.pid)
    if (others.length === 0) {
      break
    }
    if (Date.now() > deadline) {
      release()
      throw new Error(
        `${others.length} browser audits of other runs still running after ${WAIT_MS / 60_000} minutes`
      )
    }
    if (!toldDrain) {
      log(
        `waiting: ${others.length} browser audits of other runs finish before ${what}`
      )
      toldDrain = true
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- waiting is the point
    await Bun.sleep(POLL_MS)
  }
  return release
}

let slotCount = 0

/**
 * One of SLOTS machine-wide places for a browser audit, waiting while all are taken or timing work holds the
 * machine. Returns the release
 */
export const holdSlot = async (
  repo: Repo,
  log: (message: string) => void
): Promise<() => void> => {
  const dir = slotDir(repo)
  const lock = lockFile(repo)
  const deadline = Date.now() + WAIT_MS
  let told = ''
  const wait = async (why: string) => {
    if (Date.now() > deadline) {
      throw new Error(
        `no browser slot after ${WAIT_MS / 60_000} minutes: ${why}`
      )
    }
    if (told !== why) {
      log(`waiting: ${why}`)
      told = why
    }
    await Bun.sleep(POLL_MS)
  }
  for (;;) {
    const holder = holderOf(lock)
    if (
      holder !== null &&
      holder.pid !== process.pid &&
      holder.what !== WHOLE_RUN
    ) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- waiting is the point
      await wait(`${holder.what} (pid ${holder.pid}) has the machine to itself`)
      continue
    }
    if (liveSlots(dir).length >= SLOTS) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- waiting is the point
      await wait(`all ${SLOTS} browser slots on this machine are in use`)
      continue
    }
    slotCount += 1
    const name = `${process.pid}-${slotCount}.json`
    const file = path.join(dir, name)
    writeFileSync(
      file,
      JSON.stringify({ at: now(), pid: process.pid, what: 'audit' })
    )
    mine.add(file)
    const release = () => {
      rmSync(file, { force: true })
      mine.delete(file)
    }
    // Two runs taking the last slot at once both see room: the later one (by time, then name) gives way. So does
    // one that took a slot just as timing work took the machine
    const rank = liveSlots(dir).findIndex((s) => s.name === name)
    const timing = holderOf(lock)
    if (
      rank < SLOTS &&
      rank !== -1 &&
      (timing === null ||
        timing.pid === process.pid ||
        timing.what === WHOLE_RUN)
    ) {
      return release
    }
    release()
    // oxlint-disable-next-line eslint/no-await-in-loop -- a beat before trying again
    await Bun.sleep(50 + Math.random() * 200)
  }
}
