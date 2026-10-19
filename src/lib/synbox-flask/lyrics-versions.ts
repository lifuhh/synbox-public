const BE_ADDRESS = import.meta.env.VITE_SYNBOX_BE_URL

export interface LyricsFields {
  full_lyrics: string
  plain_lyrics: string
  romaji: string
  eng_translation: string
  chi_translation: string
  labelled_full_lyrics: string
}

export interface LyricsVersionSummary {
  version: number
  source: string
  note: string
  created_at: string
  summary: {
    lines: number
    timed: number | null
    english: number | null
    chinese: number | null
    romaji: number | null
    readings: number | null
  }
}

export interface LyricsVersionsResponse {
  video_id: string
  active: number | null
  versions: LyricsVersionSummary[]
}

interface LyricsVersionResponse {
  video_id: string
  version: number
  fields: LyricsFields
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${BE_ADDRESS}${path}`, init)
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : `Request failed (HTTP ${response.status})`
    throw new Error(message)
  }
  return body as T
}

export const listLyricsVersions = async (videoId: string) =>
  await request<LyricsVersionsResponse>(
    `/lyrics/${encodeURIComponent(videoId)}/versions`
  )

// Same shape as getSongLyricsById, so the player can show a version unchanged.
export const getLyricsVersion = async (videoId: string, version: number) => {
  const body = await request<LyricsVersionResponse>(
    `/lyrics/${encodeURIComponent(videoId)}/versions/${version}`
  )
  return { ...body.fields, videoId }
}

export const addLyricsVersion = async (videoId: string, fields: LyricsFields) =>
  await request<{ version: number; active: number | null }>(
    `/lyrics/${encodeURIComponent(videoId)}/versions`,
    {
      body: JSON.stringify({ fields }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  )

export const activateLyricsVersion = async (
  videoId: string,
  version: number,
  adminToken: string
) =>
  await request<{ active: number }>(
    `/lyrics/${encodeURIComponent(videoId)}/active`,
    {
      body: JSON.stringify({ version }),
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': adminToken,
      },
      method: 'POST',
    }
  )
