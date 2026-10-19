import type { KaraokeDoc, SubtitleInfo } from '@/types'

const BE_ADDRESS = import.meta.env.VITE_SYNBOX_BE_URL

// Aborts /translate-annotate when the stream goes this long without a byte
const ANNOTATE_IDLE_TIMEOUT = 30_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// Shallow shape check: enough that rendering cannot throw on a malformed doc
const KARAOKE_DOC_VERSIONS: readonly unknown[] = [1, 2]

export const isKaraokeDoc = (value: unknown): value is KaraokeDoc =>
  isRecord(value) &&
  KARAOKE_DOC_VERSIONS.includes(value.version) &&
  Array.isArray(value.lines) &&
  value.lines.every(
    (line: unknown) =>
      isRecord(line) &&
      typeof line.start === 'number' &&
      typeof line.end === 'number' &&
      Array.isArray(line.tokens) &&
      line.tokens.every(
        (token: unknown) =>
          isRecord(token) &&
          typeof token.surface === 'string' &&
          Array.isArray(token.ruby) &&
          Array.isArray(token.morae)
      )
  )

// null when the song has no karaoke timing yet (404)
export const getKaraoke = async (
  id: string,
  signal?: AbortSignal
): Promise<KaraokeDoc | null> => {
  const response = await fetch(
    `${BE_ADDRESS}/karaoke/${encodeURIComponent(id)}`,
    { headers: { Accept: 'application/json' }, signal }
  )
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`Karaoke request failed with status ${response.status}`)
  }
  const doc: unknown = await response.json()
  if (!isKaraokeDoc(doc)) {
    throw new Error('Unsupported karaoke document')
  }
  return doc
}

interface StreamMessage {
  type: string
  data: unknown
}

export interface TimedLyric {
  start_time: number
  end_time: number
  lyric: string
}

export interface TranscriptionInfo {
  lyrics: string[]
  timestamped_lyrics: TimedLyric[]
}

const isTimedLyric = (value: unknown): value is TimedLyric =>
  isRecord(value) &&
  typeof value.start_time === 'number' &&
  typeof value.end_time === 'number' &&
  typeof value.lyric === 'string'

export type AnnotationType =
  | 'eng_translation'
  | 'chi_translation'
  | 'romaji_lyrics'
  | 'kanji_annotations'

const ANNOTATION_TYPES: readonly string[] = [
  'eng_translation',
  'chi_translation',
  'romaji_lyrics',
  'kanji_annotations',
] satisfies AnnotationType[]

const isAnnotationType = (type: string): type is AnnotationType =>
  ANNOTATION_TYPES.includes(type)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const STREAM_HEADERS = {
  Accept: 'application/x-ndjson, application/json, text/plain',
  'Content-Type': 'application/json',
  Connection: 'keep-alive',
}

// Returns the message types seen, so a caller can tell a stream that closed before its result
// arrived from one that finished
const readNdjsonStream = async (
  response: Response,
  onMessage: (message: StreamMessage) => void,
  onChunk?: () => void
): Promise<Set<string>> => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  // A host without the backend answers with the app's index.html and a 200
  if (!(response.headers.get('content-type') ?? '').includes('ndjson')) {
    throw new Error('The lyrics server sent an unreadable response')
  }
  if (!response.body) {
    throw new Error('ReadableStream not supported')
  }

  const seen = new Set<string>()
  const handleLine = (line: string) => {
    if (line.trim() === '') {
      return
    }
    let content: unknown
    try {
      content = JSON.parse(line)
    } catch (e) {
      console.error('Error parsing line:', line, e)
      return
    }
    if (!isRecord(content) || typeof content.type !== 'string') {
      console.error('Invalid content received:', content)
      return
    }
    seen.add(content.type)
    onMessage({ data: content.data, type: content.type })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let hasReceivedData = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    hasReceivedData = true
    onChunk?.()
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      handleLine(line)
    }
  }
  if (!hasReceivedData) {
    throw new Error('Stream ended without receiving any data')
  }
  handleLine(buffer)
  return seen
}

const reportStreamError = (
  error: unknown,
  onError: (error: string) => void,
  signal: AbortSignal | undefined
) => {
  // The caller cancelled (dialog closed, or a retry replaced this request): nothing to report
  if (signal?.aborted === true) {
    return
  }
  if (error instanceof Error) {
    onError(error.name === 'AbortError' ? 'Request timed out' : error.message)
  } else {
    onError('An unknown error occurred')
  }
}

export const streamValidateVideoById = async (
  videoId: string,
  onUpdate: (message: string) => void,
  onVidInfo: (info: unknown) => void,
  onError: (error: string) => void,
  onSuccess: () => void,
  signal?: AbortSignal
) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, 30_000)

  try {
    const response = await fetch(`${BE_ADDRESS}/validate`, {
      method: 'POST',
      body: JSON.stringify({ id: videoId }),
      headers: STREAM_HEADERS,
      signal: signal || controller.signal,
      keepalive: true,
    })

    const seen = await readNdjsonStream(response, ({ type, data }) => {
      switch (type) {
        case 'update':
        case 'data': {
          onUpdate(String(data))
          break
        }
        case 'vid_info': {
          onVidInfo(data)
          break
        }
        case 'error': {
          onError(String(data))
          break
        }
        default: {
          console.warn('Unknown message type:', type)
        }
      }
    })

    if (!seen.has('vid_info') && !seen.has('error')) {
      onError('The server closed the connection before sending the video info')
      return
    }
    onSuccess()
  } catch (error) {
    reportStreamError(error, onError, signal)
  } finally {
    clearTimeout(timeoutId)
  }
}

export const streamTranscribeVideoById = async (
  videoId: string,
  subtitleInfo: SubtitleInfo,
  onUpdate: (message: string) => void,
  onLyricsInfo: (info: TranscriptionInfo) => void,
  onError: (error: string) => void,
  onAiGenerated: (isAiGenerated: boolean) => void,
  signal?: AbortSignal,
  forceAiTranscription?: boolean
) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, 30_000)

  try {
    const response = await fetch(`${BE_ADDRESS}/transcribev2`, {
      method: 'POST',
      body: JSON.stringify({
        id: videoId,
        subtitle_info: subtitleInfo,
        force_ai_transcription: forceAiTranscription,
      }),
      headers: STREAM_HEADERS,
      signal: signal || controller.signal,
      keepalive: true,
    })

    const seen = await readNdjsonStream(response, ({ type, data }) => {
      switch (type) {
        case 'update':
        case 'data': {
          onUpdate(String(data))
          break
        }
        case 'transcription': {
          if (
            !isRecord(data) ||
            !isStringArray(data.lyrics) ||
            !Array.isArray(data.timestamped_lyrics) ||
            !data.timestamped_lyrics.every(isTimedLyric)
          ) {
            onError('The server sent malformed lyrics')
          } else if (data.lyrics.length === 0) {
            onError('No lyrics were found for this video')
          } else {
            onLyricsInfo({
              lyrics: data.lyrics,
              timestamped_lyrics: data.timestamped_lyrics,
            })
          }
          break
        }
        case 'ai_generated': {
          onAiGenerated(data === true)
          break
        }
        case 'error': {
          onError(String(data))
          break
        }
        default: {
          console.warn('Unknown message type:', type)
        }
      }
    })

    if (!seen.has('transcription') && !seen.has('error')) {
      onError('The server closed the connection before sending the lyrics')
    }
  } catch (error) {
    reportStreamError(error, onError, signal)
  } finally {
    clearTimeout(timeoutId)
  }
}

export const streamAnnotateVideoById = async (
  videoId: string,
  lyrics: string[],
  timestampedLyrics: unknown[],
  onUpdate: (message: string) => void,
  onAnnotationInfo: (type: AnnotationType, lines: string[]) => void,
  onError: (error: string) => void,
  onTaskUpdate: (task: string) => void,
  onPersisted: (version: number | null) => void,
  signal?: AbortSignal
) => {
  const controller = new AbortController()
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined
  const resetIdleTimeout = () => {
    clearTimeout(idleTimeoutId)
    idleTimeoutId = setTimeout(() => {
      controller.abort()
    }, ANNOTATE_IDLE_TIMEOUT)
  }
  const forwardAbort = () => {
    controller.abort()
  }
  signal?.addEventListener('abort', forwardAbort, { once: true })
  if (signal?.aborted === true) {
    controller.abort()
  }
  resetIdleTimeout()

  try {
    const response = await fetch(`${BE_ADDRESS}/translate-annotate`, {
      method: 'POST',
      body: JSON.stringify({
        id: videoId,
        lyrics,
        timestamped_lyrics: timestampedLyrics,
      }),
      headers: STREAM_HEADERS,
      signal: controller.signal,
      keepalive: true,
    })

    const seen = await readNdjsonStream(
      response,
      ({ type, data }) => {
        if (isAnnotationType(type)) {
          if (isStringArray(data)) {
            onAnnotationInfo(type, data)
          } else {
            onError('The server sent malformed annotations')
          }
          return
        }
        switch (type) {
          case 'update':
          case 'data': {
            onUpdate(String(data))
            break
          }
          case 'task_update': {
            onTaskUpdate(String(data))
            break
          }
          // The backend already wrote the lyrics; a regeneration also names the version it saved
          case 'persisted': {
            onPersisted(
              isRecord(data) && typeof data.version === 'number'
                ? data.version
                : null
            )
            break
          }
          case 'error': {
            onError(String(data))
            break
          }
          default: {
            console.warn('Unknown message type:', type)
          }
        }
      },
      resetIdleTimeout
    )

    if (
      !seen.has('error') &&
      ANNOTATION_TYPES.some((annotationType) => !seen.has(annotationType))
    ) {
      onError(
        'The server closed the connection before sending every annotation'
      )
    }
  } catch (error) {
    reportStreamError(error, onError, signal)
  } finally {
    clearTimeout(idleTimeoutId)
    signal?.removeEventListener('abort', forwardAbort)
  }
}
