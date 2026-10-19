// The three generation endpoints of synbox-transcribe-whisper, read as NDJSON streams of {type, data}.

import { isStageId } from './plan'
import type { StageId } from './plan'

const BE_ADDRESS = String(import.meta.env.VITE_SYNBOX_BE_URL)

// The backend sends a heartbeat at least every 10 s while a job runs
const IDLE_TIMEOUT_MS = 60_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// `retryable` failures are the connection's, and asking again attaches to the same backend job. The rest
// (the backend's own `error` message, a refused request) would fail the same way, or pay twice.
export class GenerationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

export interface ProgressEvent {
  stage: StageId
  label?: string
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
    label: typeof data.label === 'string' ? data.label : undefined,
    stage: data.stage,
  }
}

interface StreamMessage {
  type: string
  data: unknown
}

const failedRequest = (status: number) =>
  status === 429
    ? new GenerationError(
        'Too many songs requested from your network. Try again in a while.',
        false
      )
    : new GenerationError(`The lyrics server answered ${status}`, status >= 500)

// Calls `onMessage` for every message and returns when the stream ends. A backend `error` message throws.
const readStream = async (
  path: string,
  body: object,
  signal: AbortSignal,
  onMessage: (message: StreamMessage) => void
) => {
  const idle = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const touch = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idle.abort()
    }, IDLE_TIMEOUT_MS)
  }
  touch()
  try {
    let response: Response
    try {
      response = await fetch(`${BE_ADDRESS}${path}`, {
        body: JSON.stringify(body),
        headers: {
          Accept: 'application/x-ndjson',
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: AbortSignal.any([signal, idle.signal]),
      })
    } catch (error) {
      if (signal.aborted) {
        throw error
      }
      throw new GenerationError('Could not reach the lyrics server', true)
    }
    if (!response.ok) {
      throw failedRequest(response.status)
    }
    // A host without the backend answers with the app's index.html and a 200
    if (!(response.headers.get('content-type') ?? '').includes('ndjson')) {
      throw new GenerationError(
        'The lyrics server sent an unreadable response',
        false
      )
    }
    if (!response.body) {
      throw new GenerationError('This browser cannot read the stream', false)
    }

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
        throw new GenerationError(String(content.data), false)
      }
      onMessage({ data: content.data, type: content.type })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        touch()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        lines.forEach(handleLine)
      }
    } catch (error) {
      if (error instanceof GenerationError || signal.aborted) {
        throw error
      }
      throw new GenerationError(
        idle.signal.aborted
          ? 'The lyrics server stopped responding'
          : 'The connection to the lyrics server dropped',
        true
      )
    }
    handleLine(buffer)
  } finally {
    clearTimeout(idleTimer)
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

type OnProgress = (event: ProgressEvent) => void

const forwardProgress =
  (onProgress: OnProgress) =>
  ({ type, data }: StreamMessage) => {
    if (type !== 'progress') {
      return
    }
    const event = parseProgress(data)
    if (event) {
      onProgress(event)
    }
  }

// Downloads the song when it is new, and checks it is a Japanese song
export const validate = async (
  videoId: string,
  signal: AbortSignal,
  onProgress: OnProgress
): Promise<VideoSummary> => {
  // Filled in from the stream's callback, which control-flow narrowing cannot see into
  const found: { video: VideoSummary | null } = { video: null }
  const progress = forwardProgress(onProgress)
  await readStream('/validate', { id: videoId }, signal, (message) => {
    progress(message)
    if (message.type === 'vid_info') {
      found.video = parseVideo(message.data)
    }
  })
  if (found.video === null) {
    throw new GenerationError(
      'The server closed the connection before sending the song details',
      true
    )
  }
  return found.video
}

// `regenerate` redoes everything but vocal separation; `skipUploaderLyrics` leaves the uploader's subtitles
// out while YouTube Music, LRCLIB and the audio still count
export const transcribe = async (
  videoId: string,
  options: { regenerate: boolean; skipUploaderLyrics: boolean },
  signal: AbortSignal,
  onProgress: OnProgress
) => {
  const found: { lines: number | null } = { lines: null }
  const progress = forwardProgress(onProgress)
  await readStream(
    '/transcribev2',
    {
      id: videoId,
      regenerate: options.regenerate,
      skip_uploader_lyrics: options.skipUploaderLyrics,
    },
    signal,
    (message) => {
      progress(message)
      if (message.type === 'transcription') {
        const lyrics = isRecord(message.data) ? message.data.lyrics : null
        found.lines = Array.isArray(lyrics) ? lyrics.length : 0
      }
    }
  )
  if (found.lines === null) {
    throw new GenerationError(
      'The server closed the connection before sending the lyrics',
      true
    )
  }
  if (found.lines === 0) {
    throw new GenerationError('No lyrics were found for this video', false)
  }
}

// How /translate-annotate's `persisted` message says the lyrics were saved
export type SaveOutcome =
  | { kind: 'created' }
  // `active`: the backend made it the default (latest wins); older backends keep it aside
  | { kind: 'version'; version: number; active: boolean }
  | { kind: 'unchanged' }

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

// Translates the saved timing and saves the song (the backend writes the rows, or a new lyrics version)
export const translate = async (
  videoId: string,
  signal: AbortSignal,
  onProgress: OnProgress
): Promise<SaveOutcome> => {
  const found: { saved: SaveOutcome | null } = { saved: null }
  const progress = forwardProgress(onProgress)
  await readStream(
    '/translate-annotate',
    { id: videoId },
    signal,
    (message) => {
      progress(message)
      if (message.type === 'persisted') {
        found.saved = parseSaved(message.data)
      }
    }
  )
  if (found.saved === null) {
    throw new GenerationError(
      'The server closed the connection before saving the lyrics',
      true
    )
  }
  return found.saved
}
