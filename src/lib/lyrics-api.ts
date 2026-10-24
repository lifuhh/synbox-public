import { toast } from '@/components/ui/use-toast'
import { backendToken, lastAccount } from '@/lib/auth'
import {
  directKaraokeJson,
  directLyricsDates,
  directLyricsRow,
} from '@/lib/lyrics-direct'
import { deviceId } from '@/lib/song-stats'

// Lyrics and karaoke timing come from the auth Worker, one song at a time (worker/src/lyrics.ts): straight to the
// address in VITE_SYNBOX_API_URL (api.synbox.io), not through synbox.io/api, so the Worker counts each visitor's own
// network; an account sends its backend token. Unset, the dev server answers the same paths itself
// (dev/lyrics-proxy.ts), and a built site (Netlify, `check`'s bench) reads as it did before the Worker served lyrics
// (src/lib/lyrics-direct.ts) until the Worker's routes are deployed and the address is set
const API =
  import.meta.env.VITE_SYNBOX_API_URL ?? (import.meta.env.DEV ? '' : null)

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// Until the owner deploys the Worker's lyrics routes, a Worker that doesn't answer them (unreachable, no CORS, a 404
// that isn't its own "no lyrics", 405, 5xx) hands the read to the ones the app made before (src/lib/lyrics-direct.ts).
// A refusal (429) stays a refusal. The outcome is kept for RETRY_WORKER_MS, so later reads don't each pay a failing
// request. Removed, with lyrics-direct.ts, once the Worker is live
// Thrown by a read the Worker doesn't serve, so viaWorker can tell it from any other failure
const workerMissing = (message: string) =>
  Object.assign(new Error(message), { workerMissing: true })
const isWorkerMissing = (error: unknown) =>
  error instanceof Error && 'workerMissing' in error
const RETRY_WORKER_MS = 5 * 60_000
let workerMissingUntil = 0

const viaWorker = async <T>(
  worker: () => Promise<T>,
  direct: () => Promise<T>
): Promise<T> => {
  if (API === null || Date.now() < workerMissingUntil) {
    return await direct()
  }
  try {
    return await worker()
  } catch (error) {
    if (!isWorkerMissing(error)) {
      throw error
    }
    workerMissingUntil = Date.now() + RETRY_WORKER_MS
    return await direct()
  }
}

// The Worker's own "no lyrics" answer (worker/src/lyrics.ts), unlike a 404 for a route it doesn't have
const isNotFoundAnswer = async (response: Response) => {
  try {
    const body: unknown = await response.json()
    return isRecord(body) && body.code === 'not_found'
  } catch {
    return false
  }
}

// The response, or null for the Worker's own 404; a refusal throws
const get = async (path: string, signal?: AbortSignal) => {
  const headers = new Headers({ Accept: 'application/json' })
  // An account is counted by its token; a guest by this browser's id, so guests sharing a network (an office, a
  // carrier's shared address) aren't counted as one
  const token = lastAccount() === null ? null : await backendToken()
  const device = deviceId()
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`)
  } else if (device !== null) {
    headers.set('X-Synbox-Device', device)
  }
  let response: Response
  try {
    response = await fetch(`${API ?? ''}${path}`, {
      credentials: API === '' ? 'same-origin' : 'omit',
      headers,
      signal,
    })
  } catch (error) {
    if (signal?.aborted === true) {
      throw error
    }
    throw workerMissing('Lyrics routes unreachable')
  }
  if (response.status === 429) {
    noteRateLimited()
    throw new RateLimitedError()
  }
  if (response.status === 404) {
    if (await isNotFoundAnswer(response)) {
      return null
    }
    throw workerMissing('No lyrics route')
  }
  if (response.status === 405 || response.status >= 500) {
    throw workerMissing(`Lyrics routes answered ${response.status}`)
  }
  if (!response.ok) {
    throw new Error(`Lyrics request failed with status ${response.status}`)
  }
  return response
}

export interface LyricsRow {
  videoId: string
  // When the song was first generated, and when its live lyrics were last written, in ms
  createdAt: number
  updatedAt: number
  // The columns the app reads (worker/src/lyrics.ts › LYRICS_FIELDS)
  row: Record<string, unknown>
}

// A song's lyrics, or null when it has none
const workerLyricsRow = async (
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

export const fetchLyricsRow = async (
  videoId: string,
  signal?: AbortSignal
): Promise<LyricsRow | null> =>
  await viaWorker(
    async () => await workerLyricsRow(videoId, signal),
    async () => await directLyricsRow(videoId)
  )

// When each song's lyrics were last written, no text: up to 50 songs; a song without lyrics is left out
const workerLyricsDates = async (
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

export const fetchLyricsDates = async (
  videoIds: string[]
): Promise<Map<string, { updatedAt: number }>> =>
  videoIds.length === 0
    ? new Map()
    : await viaWorker(
        async () => await workerLyricsDates(videoIds),
        async () => await directLyricsDates(videoIds)
      )

// The karaoke timing document as sent (src/lib/synbox-flask/api.ts checks its shape), or null when there is none
const workerKaraokeJson = async (
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

export const fetchKaraokeJson = async (
  videoId: string,
  version: number | null,
  signal?: AbortSignal
): Promise<unknown> =>
  await viaWorker(
    async () => await workerKaraokeJson(videoId, version, signal),
    async () => await directKaraokeJson(videoId, version, signal)
  )

// The translations carry an invisible mark (worker/src/lyrics.ts › traceMark); text the app compares or searches
// goes without it
const TRACE_CHARS = new RegExp(
  `[${[0x20_60, 0x20_62, 0x20_63].map((code) => String.fromCodePoint(code)).join('')}]`,
  'gu'
)
export const withoutTrace = (text: string) => text.replaceAll(TRACE_CHARS, '')
