import { z } from 'zod'

import { backendToken } from '@/lib/auth'

import { LOOKUP_ADDRESS } from './address'

const lyricsFieldsSchema = z.object({
  chi_translation: z.string(),
  eng_translation: z.string(),
  full_lyrics: z.string(),
  labelled_full_lyrics: z.string(),
  plain_lyrics: z.string(),
  romaji: z.string(),
})

const lyricsVersionSummarySchema = z.object({
  created_at: z.string(),
  note: z.string(),
  source: z.string(),
  summary: z.object({
    chinese: z.number().nullable(),
    english: z.number().nullable(),
    lines: z.number(),
    readings: z.number().nullable(),
    romaji: z.number().nullable(),
    timed: z.number().nullable(),
  }),
  version: z.number(),
})
export type LyricsVersionSummary = z.infer<typeof lyricsVersionSummarySchema>

const lyricsVersionsResponseSchema = z.object({
  active: z.number().nullable(),
  versions: z.array(lyricsVersionSummarySchema),
  video_id: z.string(),
})
export type LyricsVersionsResponse = z.infer<
  typeof lyricsVersionsResponseSchema
>

const lyricsVersionResponseSchema = z.object({
  fields: lyricsFieldsSchema,
  version: z.number(),
  video_id: z.string(),
})

const activatedVersionSchema = z.object({ active: z.number() })

// Versions are an admin tool, so every call carries the login; the backend checks the role
const request = async <T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {}
): Promise<T> => {
  const token = await backendToken()
  const headers = new Headers(init.headers)
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${LOOKUP_ADDRESS}${path}`, { ...init, headers })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : `Request failed (HTTP ${response.status})`
    throw new Error(message)
  }
  // A host without the backend answers with the app's index.html and a 200
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new Error('The lyrics server sent an unreadable response')
  }
  return parsed.data
}

export const listLyricsVersions = async (
  videoId: string,
  signal?: AbortSignal
) =>
  await request(
    `/lyrics/${encodeURIComponent(videoId)}/versions`,
    lyricsVersionsResponseSchema,
    { signal }
  )

// Same shape as getSongLyricsById, so the player can show a version unchanged.
export const getLyricsVersion = async (videoId: string, version: number) => {
  const body = await request(
    `/lyrics/${encodeURIComponent(videoId)}/versions/${version}`,
    lyricsVersionResponseSchema
  )
  return { ...body.fields, videoId }
}

export const activateLyricsVersion = async (videoId: string, version: number) =>
  await request(
    `/lyrics/${encodeURIComponent(videoId)}/active`,
    activatedVersionSchema,
    {
      body: JSON.stringify({ version }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  )
