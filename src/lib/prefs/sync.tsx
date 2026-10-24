import { focusManager } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import { z } from 'zod'

import { reloadStoredStyleAtom } from '@/context/atoms'
import { useMe } from '@/lib/auth'

import type { PrefOp, Prefs } from './model'
import { reconcile } from './model'
import {
  applyAccountPref,
  forgetPrefTimes,
  listenForPrefChanges,
  localPrefs,
} from './storage'

// The Worker refuses more in one request (worker/src/prefs.ts › PREF_OPS_LIMIT)
const OPS_PER_REQUEST = 500
// A few quick changes (dragging a size slider) go in one request
const SEND_DELAY_MS = 1000
// The account whose settings this device last synced with, kept after sign-out: signing back in to it keeps
// what changed here meanwhile, and signing in to another account lets that account's settings win
const OWNER_KEY = 'prefsOwner'

const prefsSchema = z.object({
  prefs: z.record(z.string(), z.object({ at: z.number(), value: z.unknown() })),
})

// null: the Worker doesn't have settings yet (an app deployed before it), so they stay on the device
const fetchPrefs = async (): Promise<Prefs | null> => {
  const response = await fetch('/api/me/prefs', { credentials: 'same-origin' })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`/api/me/prefs answered ${response.status}`)
  }
  return prefsSchema.parse(await response.json()).prefs
}

const sendPrefs = async (ops: PrefOp[]) => {
  for (let start = 0; start < ops.length; start += OPS_PER_REQUEST) {
    const batch = ops.slice(start, start + OPS_PER_REQUEST)
    // oxlint-disable-next-line eslint/no-await-in-loop -- in order, one request at a time
    const response = await fetch('/api/me/prefs', {
      body: JSON.stringify({ ops: batch }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    // A refused batch (malformed, or past the account's limits) can never succeed; the next sync sends the same
    // settings again if they're still newer
    if (response.status === 400 || response.status === 413) {
      console.warn('The account refused settings', batch)
    } else if (!response.ok) {
      throw new Error(`/api/me/prefs answered ${response.status}`)
    }
  }
}

let running = false
let again = false

// Takes the account's newer settings and sends this device's newer ones. One run at a time; a call during a
// run makes it go round once more
const syncPrefs = async (reload: (key: string) => void) => {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      // oxlint-disable-next-line eslint/no-await-in-loop -- each round compares against the account as it is now
      const account = await fetchPrefs()
      if (account === null) {
        break
      }
      const { apply, send } = reconcile(account, localPrefs(), Date.now())
      // oxlint-disable-next-line eslint/no-await-in-loop -- as above
      await sendPrefs(send)
      for (const { key, value, at } of apply) {
        applyAccountPref(key, value, at)
        reload(key)
      }
    } while (again)
  } catch {
    // Offline or the Worker is down: the change times keep what to send for the next try
  }
  running = false
}

// Signed in: syncs now, a moment after each change here, and whenever the app comes back to the front or back
// online (changes made on another device show up then). Returns the cleanup
const keepInStep = (userId: string, sync: () => Promise<void>) => {
  try {
    const owner = localStorage.getItem(OWNER_KEY)
    if (owner !== null && owner !== userId) {
      forgetPrefTimes()
    }
    localStorage.setItem(OWNER_KEY, userId)
  } catch {
    // Storage blocked: nothing on this device to keep in step
  }
  void sync()
  let timer: ReturnType<typeof setTimeout> | undefined
  const stopListening = listenForPrefChanges(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      void sync()
    }, SEND_DELAY_MS)
  })
  const stopFocus = focusManager.subscribe((focused) => {
    if (focused) {
      void sync()
    }
  })
  const onOnline = () => {
    void sync()
  }
  window.addEventListener('online', onOnline)
  return () => {
    clearTimeout(timer)
    stopListening()
    stopFocus()
    window.removeEventListener('online', onOnline)
  }
}

// Keeps this device's synced settings and the signed-in account's in step (src/lib/prefs/model.ts)
export const PrefsSync = () => {
  const { data: me } = useMe()
  const userId = me?.user?.id ?? null
  const reload = useSetAtom(reloadStoredStyleAtom)
  const sync = useCallback(async () => {
    await syncPrefs(reload)
  }, [reload])

  useEffect(
    () => (userId === null ? undefined : keepInStep(userId, sync)),
    [userId, sync]
  )

  return null
}
