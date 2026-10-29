export interface formattedYoutubeVideoItemForCarousel {
  title: string
  channel: string
  thumbnailUrl: string
  videoId: string
}

interface YoutubeVideoStatistics {
  viewCount: string
  likeCount: string
  commentCount: string
}

// A song on the YouTube chart. Its views are missing when the read for them failed
export interface ChartSong {
  id: string
  rank: number
  title: string
  views: number | undefined
}

export interface YoutubeSearchResultInfo {
  id: string | { videoId: string; kind: string }
  title: string
  channelTitle: string
  description: string
  tags: string[]
  defaultAudioLanguage: string
  thumbnail: string
  duration: string
  statistics?: YoutubeVideoStatistics
}

export interface CurrentPlayingInfo {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
  // When the song was added to Synbox; only songs in its database have one
  addedAt?: string
}

// GET /karaoke/<videoId> (KaraokeDoc v1). lines[] is index-aligned with the
// stored lyric lines, so romaji and translations still switch by index.
export interface KaraokeMora {
  kana: string
  romaji: string
  start: number
  end: number
}

// rt is '' for kana and okurigana
export interface KaraokeRubySegment {
  base: string
  rt: string
}

// morae is empty for punctuation, spaces and symbols; a Latin token has one
// mora covering the whole word
export interface KaraokeToken {
  surface: string
  reading: string
  ruby: KaraokeRubySegment[]
  morae: KaraokeMora[]
  is_latin: boolean
  // A verb ending or auxiliary: its romaji runs on from the word before (kawat|te|ta shows kawatteta). Absent in
  // docs made before 2026-10-24
  joins?: boolean
}

// A degraded line's morae are an even spread across the line window
export type KaraokeLineStatus = 'verified' | 'degraded'

export interface KaraokeDocLine {
  text: string
  start: number
  end: number
  status: KaraokeLineStatus
  checks: string[]
  furigana: string
  romaji: string
  tokens: KaraokeToken[]
}

// Lines `first` to `last` (both included, up to three) share one translation, `text`
export interface KaraokeTranslationSpan {
  first: number
  last: number
  text: string
}

export interface KaraokeTranslation {
  source: 'uploader' | 'llm'
  script: string | null
  // Per line: a span's text on its first line, '' on the others
  lines: string[]
  // Every line in exactly one span, in order. Absent in docs made before spans: each line is then its own
  spans?: KaraokeTranslationSpan[]
}

export interface KaraokeDoc {
  // 2 added text_report (how the lyrics were chosen); nothing the player reads changed
  version: 1 | 2
  video_id: string
  text_source: string
  text_hash: string
  aligner: {
    name: string
    separation: string
    version: string
  }
  requested_by: string | null
  lines: KaraokeDocLine[]
  translations: Partial<Record<'en' | 'zh', KaraokeTranslation>>
}

// CSS custom properties set inline for classes to read, such as transform-(--ring-turn)
export type CssVars = Record<`--${string}`, string | number>
