/* oxlint-disable promise/prefer-await-to-then -- zod's .catch() sets a schema's fallback value; it is not a promise */
import { z } from 'zod'

import type { GallerySong } from '@/lib/appwrite/api'
import { shuffleArray } from '@/utils'

import { LOOKUP_ADDRESS } from './address'

const videoSearchResultSchema = z.object({
  channel: z.string(),
  duration_s: z.number().nullable(),
  group: z.number(),
  processed: z.boolean(),
  source: z.enum(['youtube', 'library']).catch('youtube'),
  thumbnail_url: z.string(),
  title: z.string(),
  video_id: z.string(),
})
export type VideoSearchResult = z.infer<typeof videoSearchResultSchema>

const videoSearchResponseSchema = z.object({
  filtered: z.boolean(),
  query: z.string(),
  results: z.array(videoSearchResultSchema),
  source: z.enum(['youtube', 'library_only']).catch('youtube'),
})
export type VideoSearchResponse = z.infer<typeof videoSearchResponseSchema>

const librarySongSchema = z.object({
  artist: z.string(),
  // The song's strongest mood and kind of singer, from the backend's tags; none for a song not yet tagged
  mood: z.string().nullable().catch(null),
  thumbnail_url: z.string(),
  title: z.string(),
  video_id: z.string(),
  vocal: z.string().catch('unknown'),
})
export type LibrarySong = z.infer<typeof librarySongSchema>

const librarySearchResponseSchema = z.object({
  facets: z.object({
    artist: z.string().nullable(),
    mood: z.string().nullable(),
    vocal: z.string().nullable(),
  }),
  mode: z.enum(['ranked', 'title_match']).catch('ranked'),
  query: z.string(),
  ready: z.boolean(),
  results: z.array(librarySongSchema),
})
export type LibrarySearchResponse = z.infer<typeof librarySearchResponseSchema>

const similarSongsResponseSchema = z.object({
  results: z.array(librarySongSchema),
  // Null from a backend that predates it
  song: librarySongSchema.nullable().catch(null),
  video_id: z.string(),
})
export type SimilarSongsResponse = z.infer<typeof similarSongsResponseSchema>

const gallerySongsSchema = z.object({
  songs: z.array(
    z.object({
      artist: z.string(),
      // False from a backend that predates it
      karaoke: z.boolean().catch(false),
      thumbnail_url: z.string(),
      title: z.string(),
      video_id: z.string(),
    })
  ),
})

export interface LibraryListSong extends GallerySong {
  // Its lyrics are timed word by word, so the player fills them as they are sung
  karaoke: boolean
}

// Every song in the library, in a fresh order each visit. Same-origin: a Netlify function asks the lookup
// service and answers its last good list when that service is cold (netlify/library-songs.ts), so the home page
// costs no Appwrite reads and doesn't wait on a cold start. 503 only before any list was ever kept
export const getLibrarySongs = async (): Promise<LibraryListSong[]> => {
  const response = await fetch('/api/library/songs')
  if (!response.ok) {
    throw new Error(`The gallery failed to load (HTTP ${response.status})`)
  }
  const { songs } = gallerySongsSchema.parse(await response.json())
  return shuffleArray(
    songs.map((song) => ({
      author: song.artist,
      karaoke: song.karaoke,
      thumbnailUrl: song.thumbnail_url,
      title: song.title,
      videoId: song.video_id,
    }))
  )
}

const getJson = async <T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal
): Promise<T> => {
  const response = await fetch(`${LOOKUP_ADDRESS}${path}`, { signal })
  if (response.status === 404) {
    throw new Error('This song is not in the library yet')
  }
  if (response.status === 429) {
    throw new Error('Too many searches, try again in a minute')
  }
  if (!response.ok) {
    throw new Error(`Search failed (HTTP ${response.status})`)
  }
  const body: unknown = await response.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new Error('The search server sent an unexpected response')
  }
  return parsed.data
}

export const searchVideos = async (query: string, signal?: AbortSignal) =>
  await getJson(
    `/search?q=${encodeURIComponent(query)}`,
    videoSearchResponseSchema,
    signal
  )

const LIBRARY_RETRY_MS = 3000
const LIBRARY_WAIT_MS = 120_000

const wait = async (ms: number, signal?: AbortSignal) => {
  // oxlint-disable-next-line promise/avoid-new -- turns setTimeout into a promise
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

// A backend that has just started answers `ready: false` for about a minute while it loads the library. Keep
// asking, so the search stays loading instead of showing an empty library; give up after 2 minutes.
const askLibrary = async (
  query: string,
  deadline: number,
  signal?: AbortSignal
): Promise<LibrarySearchResponse> => {
  const response = await getJson(
    `/library/search?q=${encodeURIComponent(query)}`,
    librarySearchResponseSchema,
    signal
  )
  if (response.ready || Date.now() >= deadline || signal?.aborted === true) {
    return response
  }
  await wait(LIBRARY_RETRY_MS, signal)
  return await askLibrary(query, deadline, signal)
}

export const searchLibrary = async (query: string, signal?: AbortSignal) =>
  await askLibrary(query, Date.now() + LIBRARY_WAIT_MS, signal)

export const getSimilarSongs = async (videoId: string, signal?: AbortSignal) =>
  await getJson(
    `/library/similar/${encodeURIComponent(videoId)}`,
    similarSongsResponseSchema,
    signal
  )
