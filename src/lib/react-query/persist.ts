// The last public lists, kept on this device so the app opens on them instead of placeholders. Only the keys named
// in PERSISTED are ever written or read back: nothing about an account, no session, no admin data, no generation
// state and no lyrics (those have their own offline copy, lib/offline)
import type { QueryClient } from '@tanstack/react-query'
import { createStore, del, get, set } from 'idb-keyval'

import { shuffleArray } from '@/utils'

import { shouldRefetch } from '../home-refresh'
import { QUERY_KEYS } from './query-keys'

interface Rule {
  // How many queries under this key are kept, newest first (one per song for a per-song key)
  keep: number
  // Asked again when the app opens on a copy older than Home's refetch window (home-refresh.ts), whatever the
  // query's own staleTime: a launch has always shown the day's lists
  refetchOnLaunch?: true
  // Its fetcher shuffles, so a kept copy is shuffled again on each launch
  shuffled?: true
}

// By the query key's first element. Everything here is the same for every visitor and holds no lyric text
const PERSISTED = new Map<unknown, Rule>([
  [
    QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST,
    { keep: 1, refetchOnLaunch: true, shuffled: true },
  ],
  [QUERY_KEYS.GET_CHARTS_PLAYLIST, { keep: 1, refetchOnLaunch: true }],
  [
    QUERY_KEYS.GET_GALLERY_SONGS,
    { keep: 1, refetchOnLaunch: true, shuffled: true },
  ],
  // Everyone's listens on the cards, and the chart's own songs'
  [QUERY_KEYS.GET_LISTEN_COUNTS, { keep: 3 }],
  [QUERY_KEYS.GET_RECENT_LISTENS, { keep: 1 }],
  [QUERY_KEYS.GET_SONG_INFO_BY_SONG_ID, { keep: 30 }],
  [QUERY_KEYS.GET_YOUTUBE_VIDEO_INFO, { keep: 30 }],
  [QUERY_KEYS.GET_SIMILAR_SONGS, { keep: 30 }],
])

export const persistRule = (queryKey: readonly unknown[]) =>
  PERSISTED.get(queryKey[0])

// A copy older than this is dropped. The home lists are asked again on launch anyway, so an old copy shows only
// until that answers; a week covers someone who opens the app every few days
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface Saved {
  queryKey: readonly unknown[]
  data: unknown
  dataUpdatedAt: number
}

const isSaved = (entry: unknown): entry is Saved =>
  typeof entry === 'object' &&
  entry !== null &&
  'queryKey' in entry &&
  Array.isArray(entry.queryKey) &&
  'data' in entry &&
  entry.data !== undefined &&
  'dataUpdatedAt' in entry &&
  typeof entry.dataUpdatedAt === 'number'

// What may be written, and what may be read back: allowlisted keys only, nothing past its age or dated in the
// future, a shuffled list only as a list, and each key's newest `keep`
export const keepable = (entries: readonly unknown[], now: number): Saved[] => {
  const kept = new Map<unknown, number>()
  return entries
    .filter(isSaved)
    .toSorted((a, b) => b.dataUpdatedAt - a.dataUpdatedAt)
    .filter((entry) => {
      const rule = persistRule(entry.queryKey)
      const count = kept.get(entry.queryKey[0]) ?? 0
      if (
        rule === undefined ||
        entry.dataUpdatedAt > now ||
        now - entry.dataUpdatedAt > MAX_AGE_MS ||
        (rule.shuffled === true && !Array.isArray(entry.data)) ||
        count >= rule.keep
      ) {
        return false
      }
      kept.set(entry.queryKey[0], count + 1)
      return true
    })
}

// The stored copy's entries, or none when it is not this build's (`buster`: data shapes change between builds)
// or not in the shape written here
export const restorable = (
  stored: unknown,
  buster: string,
  now: number
): Saved[] =>
  typeof stored === 'object' &&
  stored !== null &&
  'buster' in stored &&
  stored.buster === buster &&
  'queries' in stored &&
  Array.isArray(stored.queries)
    ? keepable(stored.queries, now)
    : []

const STORED_KEY = 'last'
const WRITE_EVERY_MS = 1500

// Opening the database can throw (storage switched off): then nothing is kept
const openStore = () => {
  try {
    return createStore('synbox-query-cache', 'queries')
  } catch {
    return null
  }
}

type Store = NonNullable<ReturnType<typeof openStore>>

const forget = async (store: Store) => {
  try {
    await del(STORED_KEY, store)
  } catch {
    // Nothing to do about a copy that can't be deleted: it is checked again before it is ever read back
  }
}

const isList = (data: unknown): data is unknown[] => Array.isArray(data)

// Puts the stored copy into the cache with the time it was fetched, so each query's staleTime counts from then.
// Never throws: an unreadable, old or other build's copy is deleted and the app loads as it did without one
const restore = async (client: QueryClient, store: Store) => {
  try {
    const stored: unknown = await get(STORED_KEY, store)
    const now = Date.now()
    const entries = restorable(stored, __BUILD_ID__, now)
    if (stored !== undefined && entries.length === 0) {
      await forget(store)
    }
    for (const { queryKey, data, dataUpdatedAt } of entries) {
      const rule = persistRule(queryKey)
      const cached = client.getQueryState(queryKey)?.dataUpdatedAt ?? 0
      if (rule !== undefined && cached < dataUpdatedAt) {
        client.setQueryData(
          queryKey,
          rule.shuffled === true && isList(data)
            ? shuffleArray([...data])
            : data,
          { updatedAt: dataUpdatedAt }
        )
        if (
          rule.refetchOnLaunch === true &&
          shouldRefetch(now, dataUpdatedAt)
        ) {
          void client.invalidateQueries({
            exact: true,
            queryKey,
            refetchType: 'none',
          })
        }
      }
    }
  } catch {
    await forget(store)
  }
}

// Keeps the allowlisted queries' last answers on this device and puts the stored ones back. Resolves once they
// are in the cache (or there were none)
export const persistQueries = async (client: QueryClient) => {
  const store = openStore()
  if (store === null) {
    return
  }
  // The last answer per query, also after the cache drops an unwatched query, so a song page left open doesn't
  // lose Home's lists
  const last = new Map<string, Saved>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  let failed = false

  const write = async () => {
    clearTimeout(timer)
    timer = undefined
    if (!dirty || failed) {
      return
    }
    dirty = false
    const queries = keepable([...last.values()], Date.now())
    try {
      await set(STORED_KEY, { buster: __BUILD_ID__, queries }, store)
    } catch {
      // A full disk or data that can't be stored ends keeping for this visit, and leaves no half-written copy
      failed = true
      await forget(store)
    }
  }

  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') {
      return
    }
    const queryKey: unknown = event.query.queryKey
    const data: unknown = event.query.state.data
    if (
      !isList(queryKey) ||
      persistRule(queryKey) === undefined ||
      data === undefined
    ) {
      return
    }
    last.set(event.query.queryHash, {
      data,
      dataUpdatedAt: event.query.state.dataUpdatedAt,
      queryKey,
    })
    dirty = true
    timer ??= setTimeout(() => {
      void write()
    }, WRITE_EVERY_MS)
  })
  // The last chance before the page goes: a phone ends a hidden app without another event
  window.addEventListener('pagehide', () => {
    void write()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void write()
    }
  })

  await restore(client, store)
}
