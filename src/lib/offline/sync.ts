import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { createStore, del, get, set, values } from 'idb-keyval'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { getGallerySongs, getLyricsRows } from '@/lib/appwrite/api'
import type { LyricsRow } from '@/lib/appwrite/api'
import { fetchMySongs, useMe } from '@/lib/auth'
import { karaokeMatchesLyrics } from '@/lib/karaoke'
import { favoritesAtom, historyAtom } from '@/lib/library/store'
import { parseLyricsDocument } from '@/lib/lyrics-document'
import { useOnline } from '@/lib/pwa'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { getKaraoke } from '@/lib/synbox-flask/api'
import type { KaraokeDocLine } from '@/types'

import type { OfflineSong } from './song'
import { OFFLINE_SONG_VERSION, offlineLines, romanizeTitle } from './song'

// Saved for reading offline: the account's songs, bookmarks, and the last this many songs played, so songs
// generated before sign-in existed are there too
const RECENT_LIMIT = 30

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
// On Sign Out: the next account's songs are its own
export const forgetMySongs = () => {
  writeJson(MINE_KEY, [])
}

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

// The song's karaoke timing when it belongs to these lyrics (it holds the newest generation, which an older
// active version doesn't match); null when there is none. A failed request throws
const fetchKaraoke = async (
  videoId: string,
  row: Record<string, unknown>
): Promise<KaraokeDocLine[] | null> => {
  const doc = await getKaraoke(videoId, null)
  const plain = typeof row.plain_lyrics === 'string' ? row.plain_lyrics : ''
  return doc !== null && karaokeMatchesLyrics(doc.lines, plain)
    ? doc.lines
    : null
}

// One song in the saved shape, from its lyrics row, its karaoke timing and thumbnail (fetched here), and its
// title and artist; null when the row's lyrics can't be read
const buildSong = async (
  found: LyricsRow,
  known: { title?: string; author?: string } | undefined
): Promise<OfflineSong | null> => {
  const { videoId } = found
  const lyrics = parseLyricsDocument(found.row)
  if (lyrics === null) {
    return null
  }
  const title = known?.title ?? videoId
  let karaoke: KaraokeDocLine[] | null = null
  let timingPending = false
  try {
    karaoke = await fetchKaraoke(videoId, found.row)
  } catch {
    timingPending = true
  }
  const lines = offlineLines(lyrics, karaoke)
  return {
    author: known?.author ?? '',
    generatedAt: found.createdAt,
    lines,
    thumbnail: await fetchThumbnail(videoId),
    timingPending,
    title,
    titleRomaji: romanizeTitle(title, lines),
    updatedAt: found.updatedAt,
    version: OFFLINE_SONG_VERSION,
    videoId,
  }
}

// The song the reader shows: this device's saved copy, or, online, the song fetched live, so any song can be
// read. Its own key, so a sync running in the background never swaps the lines under a reader
export const useLyricsSong = (videoId: string) =>
  useQuery({
    networkMode: 'always',
    queryFn: async (): Promise<OfflineSong | null> => {
      const saved = await get<OfflineSong>(videoId, songStore)
      if (saved !== undefined || !navigator.onLine) {
        return saved ?? null
      }
      const [rows, infos] = await Promise.all([
        getLyricsRows([videoId]),
        getGallerySongs([videoId]).catch(() => []),
      ])
      const found = rows.get(videoId)
      return found === undefined ? null : await buildSong(found, infos[0])
    },
    queryKey: [QUERY_KEYS.GET_LYRICS_SONG, videoId],
    retry: 1,
    staleTime: Infinity,
  })

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
      const info = infos.find((song) => song.videoId === videoId)
      const song =
        found === undefined
          ? null
          : await buildSong(found, info ?? wanted.get(videoId))
      if (song === null) {
        return false
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
        saved.version !== OFFLINE_SONG_VERSION ||
        saved.timingPending ||
        saved.updatedAt !== dates.get(videoId)?.updatedAt)
    )
  })
  // A missing thumbnail is fetched on its own, without the lyrics again
  await Promise.all(
    [...stored.values()]
      .filter(
        (song) =>
          song.thumbnail === null &&
          dates.has(song.videoId) &&
          !stale.includes(song.videoId)
      )
      .map(async (song) => {
        const thumbnail = await fetchThumbnail(song.videoId)
        if (thumbnail !== null) {
          await set(song.videoId, { ...song, thumbnail }, songStore)
        }
      })
  )
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

// Mounted as its own leaf in the app, never called from App: every sync request (the Lyrics menu asks on
// each open), bookmark or recent song re-renders whoever runs it, and from App that was every page
export const OfflineSync = () => {
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
        // Signed out keeps the list too: an expired session is not a choice to drop the songs. Sign Out clears it
        let mine = readMySongs()
        if (account === 'signed-in') {
          try {
            mine = await fetchMySongs()
          } catch {
            // Keeps the list from the last sync
          }
        }
        writeJson(MINE_KEY, mine)
        // Bookmarks and recent songs carry their titles, for a song whose info row is missing; a later entry
        // wins, so they come after the account's untitled ones
        const failed = await syncSongs(
          [...mine, ...history.slice(0, RECENT_LIMIT), ...favourites],
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
          runOnce(sync)
        }
      },
      asked ? 0 : SYNC_DELAY_MS
    )
    return () => {
      clearTimeout(timer)
    }
  }, [online, isPending, account, favourites, history, queryClient, requested])
  return null
}
