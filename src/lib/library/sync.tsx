import { useAtomValue, useStore } from 'jotai'
import { useCallback, useEffect } from 'react'
import { z } from 'zod'

import { useMe } from '@/lib/auth'

import type { Library, LibraryOp } from './model'
import { applyOp, emptyLibrary, libraryOps } from './model'
import { libraryAtom, libraryOutboxAtom, libraryOwnerAtom } from './store'

// The Worker refuses more in one request (worker/src/library.ts › OPS_LIMIT)
const OPS_PER_REQUEST = 500
// Changes made in quick succession (a few bookmarks, a reorder) go in one request
const SEND_DELAY_MS = 1000

const songSchema = z.object({
  author: z.string(),
  thumbnailUrl: z.string(),
  title: z.string(),
  videoId: z.string(),
})

const librarySchema = z.object({
  bookmarks: z.array(songSchema),
  history: z.array(songSchema.extend({ playedAt: z.number() })),
  playlists: z.array(
    z.object({
      createdAt: z.number(),
      id: z.string(),
      name: z.string(),
      songs: z.array(songSchema),
      updatedAt: z.number(),
    })
  ),
})

const fetchLibrary = async (): Promise<Library> => {
  const response = await fetch('/api/me/library', {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(`/api/me/library answered ${response.status}`)
  }
  const { bookmarks, history, playlists } = librarySchema.parse(
    await response.json()
  )
  return {
    bookmarks,
    history: history.map(({ playedAt, ...song }) => ({
      ...song,
      timestamp: playedAt,
    })),
    playlists,
  }
}

// false: the Worker refused these ops as malformed, so sending them again can never work
const sendOps = async (ops: LibraryOp[]) => {
  const response = await fetch('/api/me/library', {
    body: JSON.stringify({ ops }),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (response.status === 400) {
    return false
  }
  if (!response.ok) {
    throw new Error(`/api/me/library answered ${response.status}`)
  }
  return true
}

type Store = ReturnType<typeof useStore>

let running = false
let again = false

// Sends the queued changes, then takes the account's library with any changes still queued applied on top.
// One run at a time; a call during a run makes it go round once more
const syncLibrary = async (store: Store) => {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      const owner = store.get(libraryOwnerAtom)
      if (owner === null) {
        break
      }
      let pending = store.get(libraryOutboxAtom)
      while (pending.length > 0) {
        const batch = pending.slice(0, OPS_PER_REQUEST)
        // oxlint-disable-next-line eslint/no-await-in-loop -- in order, so a later change lands after an earlier one
        if (!(await sendOps(batch))) {
          console.warn('The account refused library changes', batch)
        }
        store.set(libraryOutboxAtom, (queued) => queued.slice(batch.length))
        pending = store.get(libraryOutboxAtom)
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- the next round needs this one's result in place
      let library = await fetchLibrary()
      if (store.get(libraryOwnerAtom) === owner) {
        for (const op of store.get(libraryOutboxAtom)) {
          library = applyOp(library, op)
        }
        store.set(libraryAtom, library)
      }
    } while (again)
  } catch {
    // Offline or the Worker is down: the queue keeps the changes for the next try
  }
  running = false
}

// Keeps this device's library and the signed-in account's in step. Signing in merges a guest's library into
// the account; signing out, or another account signing in, starts this device from empty
export const LibrarySync = () => {
  const store = useStore()
  const { data: me } = useMe()
  // undefined until /api/me answers (offline, it never does), so an offline start leaves the library alone
  const userId = me === undefined ? undefined : (me.user?.id ?? null)
  const outbox = useAtomValue(libraryOutboxAtom)
  const sync = useCallback(async () => {
    await syncLibrary(store)
  }, [store])

  useEffect(() => {
    if (userId === undefined) {
      return
    }
    const owner = store.get(libraryOwnerAtom)
    if (owner !== userId) {
      if (owner === null) {
        store.set(
          libraryOutboxAtom,
          libraryOps(store.get(libraryAtom), Date.now())
        )
      } else {
        store.set(libraryAtom, emptyLibrary)
        store.set(libraryOutboxAtom, [])
      }
      store.set(libraryOwnerAtom, userId)
    }
    void sync()
  }, [userId, store, sync])

  useEffect(() => {
    const timer =
      outbox.length > 0
        ? setTimeout(() => {
            void sync()
          }, SEND_DELAY_MS)
        : undefined
    return () => {
      clearTimeout(timer)
    }
  }, [outbox, sync])

  // Changes made on another device show up when the app comes back to the front or back online
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void sync()
      }
    }
    const onOnline = () => {
      void sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [sync])

  return null
}
