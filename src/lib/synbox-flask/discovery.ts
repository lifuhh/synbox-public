const BE_ADDRESS = import.meta.env.VITE_SYNBOX_BE_URL

export interface VideoSearchResult {
  video_id: string
  title: string
  channel: string
  thumbnail_url: string
  duration_s: number | null
  processed: boolean
  version: 'full' | 'tv_size' | 'live' | null
  is_cover: boolean | null
  group: number
  source: 'youtube' | 'library'
}

export interface VideoSearchResponse {
  query: string
  results: VideoSearchResult[]
  filtered: boolean
  source: 'youtube' | 'library_only'
}

export interface LibrarySong {
  video_id: string
  title: string
  artist: string
  thumbnail_url: string
  mood: string | null
  themes: string[]
  vocal: 'female' | 'male' | 'mixed' | 'synth' | 'unknown'
  difficulty: 'beginner' | 'intermediate' | 'advanced' | null
  explicit: boolean
}

export interface LibrarySearchResponse {
  query: string
  mode: 'ranked' | 'title_match'
  ready: boolean
  facets: { mood: string | null; vocal: string | null; artist: string | null }
  results: (LibrarySong & { fit: number | null; vocal_unknown: boolean })[]
}

export interface SimilarSongsResponse {
  video_id: string
  results: LibrarySong[]
}

const getJson = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(`${BE_ADDRESS}${path}`, { signal })
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
  return body as T
}

export const searchVideos = async (query: string, signal?: AbortSignal) =>
  await getJson<VideoSearchResponse>(
    `/search?q=${encodeURIComponent(query)}`,
    signal
  )

export const searchLibrary = async (query: string, signal?: AbortSignal) =>
  await getJson<LibrarySearchResponse>(
    `/library/search?q=${encodeURIComponent(query)}`,
    signal
  )

export const getSimilarSongs = async (videoId: string, signal?: AbortSignal) =>
  await getJson<SimilarSongsResponse>(
    `/library/similar/${encodeURIComponent(videoId)}`,
    signal
  )
