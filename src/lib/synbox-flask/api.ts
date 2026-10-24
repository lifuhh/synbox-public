import { fetchKaraokeJson } from '@/lib/lyrics-api'
import type { KaraokeDoc } from '@/types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// Shallow shape check: enough that rendering cannot throw on a malformed doc
const KARAOKE_DOC_VERSIONS: ReadonlySet<unknown> = new Set([1, 2])

export const isKaraokeDoc = (value: unknown): value is KaraokeDoc =>
  isRecord(value) &&
  KARAOKE_DOC_VERSIONS.has(value.version) &&
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

// null when the song (or that saved version) has no karaoke timing (404). Through the Worker (src/lib/lyrics-api.ts)
export const getKaraoke = async (
  id: string,
  version: number | null,
  signal?: AbortSignal
): Promise<KaraokeDoc | null> => {
  const doc = await fetchKaraokeJson(id, version, signal)
  if (doc === null) {
    return null
  }
  if (!isKaraokeDoc(doc)) {
    throw new Error('Unsupported karaoke document')
  }
  return doc
}
