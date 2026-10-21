import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { createStore, del, get, set, values } from 'idb-keyval'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { favoritesAtom, historyAtom } from '@/context/atoms'
import { getGallerySongs, getLyricsRows } from '@/lib/appwrite/api'
import { fetchMySongs, useMe } from '@/lib/auth'
import { parseLyricsDocument } from '@/lib/lyrics-document'
import { useOnline } from '@/lib/pwa'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

import type { OfflineSong } from './song'
import { offlineLines, romanizeTitle } from './song'

// Which lists a saved song is on. Recent is the last RECENT_LIMIT songs opened, so songs generated before
// sign-in existed are there too
export type OfflineSource = 'mine' | 'bookmark' | 'recent'
export const RECENT_LIMIT = 30

interface MySong {
  videoId: string
  generatedAt: number
}

interface WantedSong {
  videoId: string
  title?: string
  author?: string
}

export type SyncStatus =
  | { kind: 'idle'; syncedAt: number | null; failed: number }
  | { kind: 'saving'; done: number; total: number }
  | { kind: 'error'; syncedAt: number | null }

const songStore = createStore('synbox-offline', 'songs')
const MINE_KEY = 'offlineMine'
const SYNCED_AT_KEY = 'offlineSyncedAt'
// Starts after the landing page's own requests and page prefetch, and lets bookmark taps settle first
const SYNC_DELAY_MS = 5000
// Songs fetched per request: a lyrics row is tens of kilobytes
const CHUNK = 10
// Appwrite takes 100 ids in one equal(); every song is asked under two encodings
const DATES_CHUNK = 50

const readJson = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be full or refused; the next sync tries again
  }
}

const isMySong = (value: unknown): value is MySong =>
  typeof value === 'object' &&
  value !== null &&
  'videoId' in value &&
  typeof value.videoId === 'string' &&
  'generatedAt' in value &&
  typeof value.generatedAt === 'number'

// The account's songs as of the last sync, so the list still knows them offline
export const readMySongs = (): MySong[] => {
  const stored = readJson(MINE_KEY)
  return Array.isArray(stored) ? stored.filter(isMySong) : []
}

const readSyncedAt = () => {
  const stored = readJson(SYNCED_AT_KEY)
  return typeof stored === 'number' ? stored : null
}

let status: SyncStatus = { failed: 0, kind: 'idle', syncedAt: readSyncedAt() }
const listeners = new Set<() => void>()
const setStatus = (next: SyncStatus) => {
  status = next
  for (const listener of listeners) {
    listener()
  }
}

export const useSyncStatus = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => status
  )

export const useOfflineSongs = () =>
  useQuery({
    // Reads this device's storage, so it runs offline too
    networkMode: 'always',
    queryFn: async () => await values<OfflineSong>(songStore),
    queryKey: [QUERY_KEYS.GET_OFFLINE_SONGS],
    staleTime: Infinity,
  })

export const useOfflineSong = (videoId: string) =>
  useQuery({
    networkMode: 'always',
    queryFn: async () => (await get<OfflineSong>(videoId, songStore)) ?? null,
    queryKey: [QUERY_KEYS.GET_OFFLINE_SONGS, videoId],
    staleTime: Infinity,
  })

const chunked = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size)
  )

// A data URL rather than a Blob: WebKit refuses Blobs in IndexedDB in some sessions (private browsing)
const readAsDataUrl = async (blob: Blob) =>
  // oxlint-disable-next-line promise/avoid-new -- FileReader reports through events
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const { result } = reader
      if (typeof result === 'string') {
        resolve(result)
      } else {
        reject(new Error('Could not read the thumbnail'))
      }
    })
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Could not read the thumbnail'))
    })
    reader.readAsDataURL(blob)
  })

const fetchThumbnail = async (videoId: string) => {
  try {
    const response = await fetch(
      `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`
    )
    return response.ok ? await readAsDataUrl(await response.blob()) : null
  } catch {
    return null
  }
}

// Saves one stretch of songs; returns how many could not be saved
const saveChunk = async (
  ids: string[],
  wanted: Map<string, WantedSong>
): Promise<number> => {
  const [rows, infos] = await Promise.all([
    getLyricsRows(ids),
    getGallerySongs(ids).catch(() => []),
  ])
  const results = await Promise.all(
    ids.map(async (videoId) => {
      const found = rows.get(videoId)
      const lyrics = found === undefined ? null : parseLyricsDocument(found.row)
      if (found === undefined || lyrics === null) {
        return false
      }
      const info = infos.find((song) => song.videoId === videoId)
      const known = wanted.get(videoId)
      const title = info?.title ?? known?.title ?? videoId
      const lines = offlineLines(lyrics)
      const song: OfflineSong = {
        author: info?.author ?? known?.author ?? '',
        generatedAt: found.createdAt,
        lines,
        thumbnail: await fetchThumbnail(videoId),
        title,
        titleRomaji: romanizeTitle(title, lines),
        updatedAt: found.updatedAt,
        videoId,
      }
      await set(videoId, song, songStore)
      return true
    })
  )
  return results.filter((saved) => !saved).length
}

// Brings this device's saved songs in line with the lists: fetches what is new or was regenerated, retries a
// missing thumbnail, and deletes what is on no list any more. Running it twice changes nothing the second time
const syncSongs = async (
  wantedSongs: WantedSong[],
  queryClient: QueryClient
) => {
  const wanted = new Map(wantedSongs.map((song) => [song.videoId, song]))
  const ids = [...wanted.keys()]
  const dates = new Map<string, { updatedAt: number }>()
  for (const chunk of chunked(ids, DATES_CHUNK)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a handful of small requests, one after another
    const rows = await getLyricsRows(chunk, { datesOnly: true })
    for (const [videoId, row] of rows) {
      dates.set(videoId, row)
    }
  }
  const savedSongs = await values<OfflineSong>(songStore)
  const stored = new Map(savedSongs.map((song) => [song.videoId, song]))
  await Promise.all(
    [...stored.keys()]
      .filter((videoId) => !dates.has(videoId))
      .map(async (videoId) => {
        await del(videoId, songStore)
      })
  )
  const stale = ids.filter((videoId) => {
    const saved = stored.get(videoId)
    return (
      dates.has(videoId) &&
      (saved === undefined ||
        saved.thumbnail === null ||
        saved.updatedAt !== dates.get(videoId)?.updatedAt)
    )
  })
  let failed = 0
  for (const [index, chunk] of chunked(stale, CHUNK).entries()) {
    setStatus({ done: index * CHUNK, kind: 'saving', total: stale.length })
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one stretch at a time keeps a phone's connection free
      failed += await saveChunk(chunk, wanted)
    } catch {
      failed += chunk.length
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- shows each stretch as it lands
    await queryClient.invalidateQueries({
      queryKey: [QUERY_KEYS.GET_OFFLINE_SONGS],
    })
  }
  await queryClient.invalidateQueries({
    queryKey: [QUERY_KEYS.GET_OFFLINE_SONGS],
  })
  return failed
}

let running: Promise<void> | null = null
let queued: (() => Promise<void>) | null = null

// One sync at a time; a request during one runs once it ends, with the lists as they are then
const runOnce = (sync: () => Promise<void>) => {
  if (running !== null) {
    queued = sync
    return
  }
  running = (async () => {
    await sync()
    running = null
    const next = queued
    queued = null
    if (next !== null) {
      runOnce(next)
    }
  })()
}

// A sync asked for by the offline page (on opening, or its Refresh button); bumps a counter the hook watches
let requests = 0
const requestListeners = new Set<() => void>()
export const requestSync = () => {
  requests += 1
  for (const listener of requestListeners) {
    listener()
  }
}
const useSyncRequests = () =>
  useSyncExternalStore(
    (listener) => {
      requestListeners.add(listener)
      return () => {
        requestListeners.delete(listener)
      }
    },
    () => requests
  )

export const useOfflineSync = () => {
  const requested = useSyncRequests()
  const lastRequest = useRef(requested)
  const favourites = useAtomValue(favoritesAtom)
  const history = useAtomValue(historyAtom)
  const online = useOnline()
  const { data: me, isPending } = useMe()
  const queryClient = useQueryClient()
  // Unknown while /api/me has not answered: the account's list from the last sync stands until it does
  let account: 'signed-in' | 'signed-out' | 'unknown' = 'unknown'
  if (me !== undefined) {
    account = me.user === null ? 'signed-out' : 'signed-in'
  }

  useEffect(() => {
    const asked = requested !== lastRequest.current
    lastRequest.current = requested
    const sync = async () => {
      setStatus({ done: 0, kind: 'saving', total: 0 })
      try {
        let mine = readMySongs()
        if (account === 'signed-out') {
          mine = []
        } else if (account === 'signed-in') {
          try {
            mine = await fetchMySongs()
          } catch {
            // Keeps the list from the last sync
          }
        }
        writeJson(MINE_KEY, mine)
        // Bookmarks and recent songs carry their titles, for a song whose info row is missing
        const failed = await syncSongs(
          [...favourites, ...history.slice(0, RECENT_LIMIT), ...mine],
          queryClient
        )
        const syncedAt = Date.now()
        writeJson(SYNCED_AT_KEY, syncedAt)
        setStatus({ failed, kind: 'idle', syncedAt })
      } catch {
        setStatus({ kind: 'error', syncedAt: readSyncedAt() })
      }
    }
    const timer = setTimeout(
      () => {
        if (online && !isPending) {
          // Asks the browser not to clear the saved songs to free space
          void navigator.storage?.persist?.()
          runOnce(sync)
        }
      },
      asked ? 0 : SYNC_DELAY_MS
    )
    return () => {
      clearTimeout(timer)
    }
  }, [online, isPending, account, favourites, history, queryClient, requested])
}
