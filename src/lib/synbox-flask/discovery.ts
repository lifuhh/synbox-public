/* oxlint-disable promise/prefer-await-to-then -- zod's .catch() sets a schema's fallback value; it is not a promise */
import { z } from 'zod'

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
  thumbnail_url: z.string(),
  title: z.string(),
  video_id: z.string(),
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

export const searchLibrary = async (query: string, signal?: AbortSignal) =>
  await getJson(
    `/library/search?q=${encodeURIComponent(query)}`,
    librarySearchResponseSchema,
    signal
  )

export const getSimilarSongs = async (videoId: string, signal?: AbortSignal) =>
  await getJson(
    `/library/similar/${encodeURIComponent(videoId)}`,
    similarSongsResponseSchema,
    signal
  )
