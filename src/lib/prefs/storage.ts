import { createJSONStorage } from 'jotai/utils'
import { z } from 'zod'

import type { LocalPref } from './model'
import { isSyncedKey } from './model'

// When each synced setting last changed on this device, so the newest change wins against the account's
const TIMES_KEY = 'prefsChangedAt'
const timesSchema = z.record(z.string(), z.number())

const readTimes = (): Record<string, number> => {
  try {
    const parsed = timesSchema.safeParse(
      JSON.parse(localStorage.getItem(TIMES_KEY) ?? '{}')
    )
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

const writeTimes = (times: Record<string, number>) => {
  try {
    localStorage.setItem(TIMES_KEY, JSON.stringify(times))
  } catch {
    // Storage full or blocked: the change still applies here, and syncs as untimed
  }
}

export const forgetPrefTimes = () => {
  writeTimes({})
}

let onLocalChange: (() => void) | null = null
// sync.tsx sends changes a moment after they happen
export const listenForPrefChanges = (listener: () => void) => {
  onLocalChange = listener
  return () => {
    onLocalChange = null
  }
}

// Notes that a setting changed on this device now. Called by every write of a synced key
export const touchPref = (key: string) => {
  if (!isSyncedKey(key)) {
    return
  }
  writeTimes({ ...readTimes(), [key]: Date.now() })
  onLocalChange?.()
}

// Atoms over a synced key hear the account's value land here
const listeners = new Map<string, Set<(value: unknown) => void>>()

// The shape atomWithStorage takes (jotai doesn't export its type)
interface SyncedStorage<Value> {
  getItem: (key: string, initialValue: Value) => Value
  setItem: (key: string, value: Value) => void
  removeItem: (key: string) => void
  subscribe: (
    key: string,
    callback: (value: Value) => void,
    initialValue: Value
  ) => () => void
}

// atomWithStorage's storage for a synced setting: local storage, as before, plus the change time and the
// account's values arriving while the app is open
export const syncedStorage = <Value>(): SyncedStorage<Value> => {
  const json = createJSONStorage<Value>(() => localStorage)
  return {
    getItem: json.getItem,
    removeItem: (key) => {
      json.removeItem(key)
      touchPref(key)
    },
    setItem: (key, value) => {
      json.setItem(key, value)
      touchPref(key)
    },
    subscribe: (key, callback, initialValue) => {
      const fromOtherTabs = json.subscribe?.(key, callback, initialValue)
      const fromAccount = (value: unknown) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion, promise/prefer-await-to-callbacks -- the account holds what this key's atom wrote, and each atom parses what it reads; jotai's storage API is callback-based
        callback(value === undefined ? initialValue : (value as Value))
      }
      const keyed = listeners.get(key) ?? new Set()
      keyed.add(fromAccount)
      listeners.set(key, keyed)
      return () => {
        fromOtherTabs?.()
        keyed.delete(fromAccount)
      }
    },
  }
}

const parseStored = (raw: string | null): unknown => {
  if (raw === null) {
    return undefined
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

// Every synced setting this device has a value or a change time for
export const localPrefs = (): Record<string, LocalPref> => {
  const times = readTimes()
  const keys = new Set([
    ...Object.keys(localStorage).filter(isSyncedKey),
    ...Object.keys(times).filter(isSyncedKey),
  ])
  return Object.fromEntries(
    [...keys].map((key) => [
      key,
      { at: times[key], value: parseStored(localStorage.getItem(key)) },
    ])
  )
}

// Writes the account's newer value on this device, under the account's time, and tells any atom over it
export const applyAccountPref = (key: string, value: unknown, at: number) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(value))
    }
  } catch {
    return
  }
  writeTimes({ ...readTimes(), [key]: at })
  for (const listener of listeners.get(key) ?? []) {
    listener(value === null ? undefined : value)
  }
}
