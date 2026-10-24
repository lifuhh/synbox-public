import { toast } from '@/components/ui/use-toast'
import { backendToken, lastAccount } from '@/lib/auth'

// Lyrics and karaoke timing come from the auth Worker, one song at a time (worker/src/lyrics.ts), never from the
// lyrics table or the lookup service directly. Straight to api.synbox.io, not through synbox.io/api, so the Worker
// counts each visitor's own network; an account sends its backend token. Unset (a local dev server), the same
// origin, which Vite passes on to the local Worker
const API = import.meta.env.VITE_SYNBOX_API_URL ?? ''

export class RateLimitedError extends Error {
  constructor() {
    super('Too many songs opened this hour')
    this.name = 'RateLimitedError'
  }
}

// One note however many requests are refused at once
const NOTE_EVERY_MS = 30_000
let notedAt = 0
const noteRateLimited = () => {
  if (Date.now() - notedAt > NOTE_EVERY_MS) {
    notedAt = Date.now()
    toast({ description: 'Try again soon', title: 'Too Many Songs' })
  }
}

// The response, or null for a 404; a refusal throws
const get = async (path: string, signal?: AbortSignal) => {
  const headers = new Headers({ Accept: 'application/json' })
  const token = lastAccount() === null ? null : await backendToken()
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${API}${path}`, {
    credentials: API === '' ? 'same-origin' : 'omit',
    headers,
    signal,
  })
  if (response.status === 429) {
    noteRateLimited()
    throw new RateLimitedError()
  }
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`Lyrics request failed with status ${response.status}`)
  }
  return response
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export interface LyricsRow {
  videoId: string
  // When the song was first generated, and when its live lyrics were last written, in ms
  createdAt: number
  updatedAt: number
  // The columns the app reads (worker/src/lyrics.ts › LYRICS_FIELDS)
  row: Record<string, unknown>
}

// A song's lyrics, or null when it has none
export const fetchLyricsRow = async (
  videoId: string,
  signal?: AbortSignal
): Promise<LyricsRow | null> => {
  const response = await get(
    `/api/lyrics/${encodeURIComponent(videoId)}`,
    signal
  )
  if (response === null) {
    return null
  }
  const body: unknown = await response.json()
  if (!isRecord(body)) {
    throw new Error('Unreadable lyrics')
  }
  return {
    createdAt: typeof body.createdAt === 'number' ? body.createdAt : 0,
    row: body,
    updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
    videoId,
  }
}

// When each song's lyrics were last written, no text: up to 50 songs; a song without lyrics is left out
export const fetchLyricsDates = async (
  videoIds: string[]
): Promise<Map<string, { updatedAt: number }>> => {
  const found = new Map<string, { updatedAt: number }>()
  if (videoIds.length === 0) {
    return found
  }
  const response = await get(
    `/api/lyrics-dates?ids=${videoIds.map(encodeURIComponent).join(',')}`
  )
  const body: unknown = response === null ? null : await response.json()
  const songs = isRecord(body) && Array.isArray(body.songs) ? body.songs : []
  for (const song of songs) {
    if (
      isRecord(song) &&
      typeof song.videoId === 'string' &&
      typeof song.updatedAt === 'number'
    ) {
      found.set(song.videoId, { updatedAt: song.updatedAt })
    }
  }
  return found
}

// The karaoke timing document as sent (src/lib/synbox-flask/api.ts checks its shape), or null when there is none
export const fetchKaraokeJson = async (
  videoId: string,
  version: number | null,
  signal?: AbortSignal
): Promise<unknown> => {
  const query = version === null ? '' : `?version=${version}`
  const response = await get(
    `/api/karaoke/${encodeURIComponent(videoId)}${query}`,
    signal
  )
  return response === null ? null : await response.json()
}

// The translations carry an invisible mark (worker/src/lyrics.ts › traceMark); text the app compares or searches
// goes without it
const TRACE_CHARS = new RegExp(
  `[${[0x20_60, 0x20_62, 0x20_63].map((code) => String.fromCodePoint(code)).join('')}]`,
  'gu'
)
export const withoutTrace = (text: string) => text.replaceAll(TRACE_CHARS, '')
