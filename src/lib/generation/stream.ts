// The three generation endpoints of synbox-transcribe-whisper, read as NDJSON streams of {type, data}.

import { backendToken } from '@/lib/auth'
import { BE_ADDRESS } from '@/lib/synbox-flask/address'
import { isKaraokeDoc } from '@/lib/synbox-flask/api'
import type { KaraokeDoc } from '@/types'

import { failedResponse, GenerationError } from './failure'
import { isStageId } from './plan'
import type { StageId } from './plan'
import { onResume } from './resume'

// The backend sends a heartbeat at least every 10 s while a job runs, so three missed ones mean the
// connection is dead. An older backend's /validate sends nothing while it waits on YouTube, so it gets longer
const JOB_IDLE_MS = 30_000
const VALIDATE_IDLE_MS = 60_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export interface ProgressEvent {
  stage: StageId
  fraction?: number
  expectedS?: number
}

const parseProgress = (data: unknown): ProgressEvent | null => {
  if (!isRecord(data) || !isStageId(data.stage)) {
    return null
  }
  return {
    expectedS:
      typeof data.expected_s === 'number' && data.expected_s > 0
        ? data.expected_s
        : undefined,
    fraction: typeof data.fraction === 'number' ? data.fraction : undefined,
    stage: data.stage,
  }
}

interface StreamMessage {
  type: string
  data: unknown
}

const handedOff = () =>
  new GenerationError('The lyrics server handed the stream over', {
    handoff: true,
  })

// A browser driven by WebDriver or a test runner says so; the backend marks the request, and the admin page's
// Signals tab shows it. A scripted client can hide it, so it is a lead, never a block
const withOrigin = (body: object) =>
  navigator.webdriver ? { ...body, webdriver: true } : body

const stale = () =>
  new GenerationError('Reconnecting to the lyrics server', { resumed: true })

// Calls `onMessage` for every message and returns when the stream ends. A backend `error` message throws.
const readStream = async (
  path: string,
  body: object,
  signal: AbortSignal,
  idleMs: number,
  onMessage: (message: StreamMessage) => void
) => {
  const idle = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  // Time in the background doesn't count toward the idle limit, even while bytes still arrive there: a
  // limit restarted in the background fired on return before the page knew it was back
  const touch = () => {
    clearTimeout(idleTimer)
    if (document.visibilityState === 'hidden') {
      return
    }
    idleTimer = setTimeout(() => {
      idle.abort()
    }, idleMs)
  }
  touch()
  const pauseIdle = () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(idleTimer)
    }
  }
  document.addEventListener('visibilitychange', pauseIdle)
  // A phone suspends a page in the background, and its connection with it. When the page gets its network
  // back the connection is replaced at once: asking again attaches to the same backend job, which replays
  // its progress from the start
  const resumed = new AbortController()
  const stopResume = onResume(() => {
    resumed.abort()
  })
  try {
    const token = await backendToken()
    let response: Response
    try {
      response = await fetch(`${BE_ADDRESS}${path}`, {
        body: JSON.stringify(withOrigin(body)),
        headers: {
          Accept: 'application/x-ndjson',
          'Content-Type': 'application/json',
          ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        },
        method: 'POST',
        signal: AbortSignal.any([signal, idle.signal, resumed.signal]),
      })
    } catch (error) {
      if (signal.aborted) {
        throw error
      }
      if (resumed.signal.aborted) {
        throw stale()
      }
      // Also what a busy server looks like: Cloud Run turns away the CORS preflight with a 429 and no
      // CORS headers, which the browser reports as a network error
      throw new GenerationError(
        "Couldn't reach the lyrics server. It may be busy with another song, so try again in a minute.",
        { lost: true }
      )
    }
    if (!response.ok) {
      let text = ''
      try {
        text = await response.text()
      } catch {
        // The status alone decides then
      }
      throw failedResponse(response.status, text)
    }
    // A host without the backend answers with the app's index.html and a 200
    if (!(response.headers.get('content-type') ?? '').includes('ndjson')) {
      throw new GenerationError('The lyrics server sent an unreadable response')
    }
    if (!response.body) {
      throw new GenerationError('This browser cannot read the stream')
    }

    // A backend that keeps streams short ends a long one with {"type": "resume"} while the job runs on
    let resumeAsked = false
    const handleLine = (line: string) => {
      if (line.trim() === '') {
        return
      }
      let content: unknown
      try {
        content = JSON.parse(line)
      } catch {
        console.error('Unreadable stream line:', line)
        return
      }
      if (!isRecord(content) || typeof content.type !== 'string') {
        return
      }
      if (content.type === 'error') {
        throw new GenerationError(String(content.data), {
          code: typeof content.code === 'string' ? content.code : undefined,
        })
      }
      if (content.type === 'resume') {
        resumeAsked = true
      }
      onMessage({ data: content.data, type: content.type })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- a stream is read one chunk at a time, in order
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        touch()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          handleLine(line)
        }
      }
    } catch (error) {
      if (error instanceof GenerationError || signal.aborted) {
        throw error
      }
      if (resumed.signal.aborted) {
        throw stale()
      }
      throw new GenerationError(
        idle.signal.aborted
          ? 'The lyrics server stopped responding'
          : 'The connection to the lyrics server dropped',
        { lost: true }
      )
    }
    handleLine(buffer)
    if (resumeAsked) {
      throw handedOff()
    }
  } finally {
    clearTimeout(idleTimer)
    document.removeEventListener('visibilitychange', pauseIdle)
    stopResume()
  }
}

export interface VideoSummary {
  title: string
  channel: string
  thumbnail: string
  durationS: number | null
}

const parseVideo = (data: unknown): VideoSummary | null => {
  const info = isRecord(data) ? data.full_vid_info : null
  if (!isRecord(info) || typeof info.title !== 'string') {
    return null
  }
  return {
    channel: typeof info.channel_name === 'string' ? info.channel_name : '',
    durationS: typeof info.duration === 'number' ? info.duration : null,
    thumbnail: typeof info.thumbnail === 'string' ? info.thumbnail : '',
    title: info.title,
  }
}

export interface Listeners {
  onProgress: (event: ProgressEvent) => void
  // Any message at all, heartbeats included: the backend is there
  onHeard: () => void
}

const forwardProgress =
  ({ onProgress, onHeard }: Listeners) =>
  ({ type, data }: StreamMessage) => {
    onHeard()
    if (type !== 'progress') {
      return
    }
    const event = parseProgress(data)
    if (event) {
      onProgress(event)
    }
  }

export interface GenerationOptions {
  regenerate: boolean
  skipUploaderLyrics: boolean
  requestId: string
}

const generationFields = (videoId: string, options: GenerationOptions) => ({
  id: videoId,
  regenerate: options.regenerate,
  request_id: options.requestId,
  // This client sends the same request again when a stream ends with {"type": "resume"}
  resume: true,
  skip_uploader_lyrics: options.skipUploaderLyrics,
})

// Checks the video can be played and downloads the song when it is new. Named by its request id, the
// validation goes on to run the whole song on the backend, so it finishes and saves while the page is away;
// the later calls attach to it (an older backend ignores the extra fields)
export const validate = async (
  videoId: string,
  options: GenerationOptions,
  signal: AbortSignal,
  listeners: Listeners
): Promise<VideoSummary> => {
  // Filled in from the stream's callback, which control-flow narrowing cannot see into
  const found: { video: VideoSummary | null } = { video: null }
  const progress = forwardProgress(listeners)
  await readStream(
    '/validate',
    generationFields(videoId, options),
    signal,
    VALIDATE_IDLE_MS,
    (message) => {
      progress(message)
      if (message.type === 'vid_info') {
        found.video = parseVideo(message.data)
      }
    }
  )
  if (found.video === null) {
    throw new GenerationError(
      'The server closed the connection before sending the song details',
      { retryable: true }
    )
  }
  return found.video
}

export interface Refusal {
  // services/accounts.py MESSAGES: sign_in_required, admin_only, quota_exceeded, ...
  code: string
  message: string
}

// The check couldn't reach the backend: a generation started now would fail its first step the same way
export const UNREACHABLE: Refusal = {
  code: 'unreachable',
  message: "Couldn't reach Synbox. Check your connection and try again.",
}

// Whether the backend would refuse this generation, asked when its button is pressed so the refusal shows
// there. null when it would go ahead
export const checkGeneration = async (
  videoId: string,
  kind: 'new' | 'regenerate'
): Promise<Refusal | null> => {
  try {
    const token = await backendToken()
    const response = await fetch(`${BE_ADDRESS}/generation-check`, {
      body: JSON.stringify(withOrigin({ id: videoId, kind })),
      headers: {
        'Content-Type': 'application/json',
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      },
      method: 'POST',
      // A cold backend takes several seconds to start
      signal: AbortSignal.timeout(20_000),
    })
    const body: unknown = await response.json()
    if (
      isRecord(body) &&
      body.ok === false &&
      typeof body.code === 'string' &&
      typeof body.message === 'string'
    ) {
      return { code: body.code, message: body.message }
    }
    return response.ok ? null : UNREACHABLE
  } catch {
    return UNREACHABLE
  }
}

// `regenerate` redoes everything but vocal separation; `skipUploaderLyrics` leaves the uploader's subtitles
// out while YouTube Music, LRCLIB and the audio still count
// `requestId` names one generation and is sent again on every reconnect: the backend replays a job it
// already finished for that id instead of running (and paying for) the whole job a second time
// Songs take turns on the backend's CPU: `onQueue` hears how many are ahead while this one waits, and 0
// when its turn comes
export const transcribe = async (
  videoId: string,
  options: GenerationOptions,
  signal: AbortSignal,
  listeners: Listeners,
  onQueue: (ahead: number) => void
) => {
  const found: { lines: number | null } = { lines: null }
  const progress = forwardProgress(listeners)
  await readStream(
    '/transcribev2',
    generationFields(videoId, options),
    signal,
    JOB_IDLE_MS,
    (message) => {
      progress(message)
      if (message.type === 'queue') {
        const ahead = isRecord(message.data) ? message.data.ahead : null
        if (typeof ahead === 'number') {
          onQueue(ahead)
        }
      }
      if (message.type === 'transcription') {
        const lyrics = isRecord(message.data) ? message.data.lyrics : null
        found.lines = Array.isArray(lyrics) ? lyrics.length : 0
      }
    }
  )
  if (found.lines === null) {
    throw new GenerationError(
      'The server closed the connection before sending the lyrics',
      { retryable: true }
    )
  }
  if (found.lines === 0) {
    throw new GenerationError('No lyrics were found for this video')
  }
}

// How /translate-annotate's `persisted` message says the lyrics were saved
export type SaveOutcome =
  | { kind: 'created' }
  // `active`: the backend made it the default (latest wins); older backends keep it aside
  | { kind: 'version'; version: number; active: boolean }
  | { kind: 'unchanged' }
  // Saved before this page heard how: the backend said so when asked again (already_finished)
  | { kind: 'finished' }

const parseSaved = (data: unknown): SaveOutcome => {
  if (isRecord(data) && data.created === true) {
    return { kind: 'created' }
  }
  if (isRecord(data) && typeof data.version === 'number') {
    return {
      active: data.active === true,
      kind: 'version',
      version: data.version,
    }
  }
  return { kind: 'unchanged' }
}

export interface Saved {
  outcome: SaveOutcome
  // The song's live karaoke doc as saved, so the player need not fetch it; null from older backends
  karaoke: KaraokeDoc | null
}

// Translates the saved timing and saves the song (the backend writes the rows, or a new lyrics version)
export const translate = async (
  videoId: string,
  requestId: string,
  signal: AbortSignal,
  listeners: Listeners
): Promise<Saved> => {
  const found: { saved: Saved | null } = { saved: null }
  const progress = forwardProgress(listeners)
  await readStream(
    '/translate-annotate',
    { id: videoId, request_id: requestId, resume: true },
    signal,
    JOB_IDLE_MS,
    (message) => {
      progress(message)
      if (message.type === 'persisted') {
        const { data } = message
        found.saved = {
          karaoke:
            isRecord(data) && isKaraokeDoc(data.karaoke) ? data.karaoke : null,
          outcome: parseSaved(data),
        }
      }
    }
  )
  if (found.saved === null) {
    throw new GenerationError(
      'The server closed the connection before saving the lyrics',
      { retryable: true }
    )
  }
  return found.saved
}
