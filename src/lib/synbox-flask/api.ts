import type { KaraokeDoc } from '@/types'

import { LOOKUP_ADDRESS } from './address'

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

// null when the song (or that saved version) has no karaoke timing (404)
export const getKaraoke = async (
  id: string,
  version: number | null,
  signal?: AbortSignal
): Promise<KaraokeDoc | null> => {
  const query = version === null ? '' : `?version=${version}`
  const response = await fetch(
    `${LOOKUP_ADDRESS}/karaoke/${encodeURIComponent(id)}${query}`,
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
