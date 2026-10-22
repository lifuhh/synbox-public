export interface formattedYoutubeVideoItemForCarousel {
  title: string
  channel: string
  description: string
  thumbnailUrl: string
  videoId: string
}

interface YoutubeVideoStatistics {
  viewCount: string
  likeCount: string
  commentCount: string
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

export interface KaraokeTranslation {
  source: 'uploader' | 'llm'
  script: string | null
  lines: string[]
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

// CSS custom properties set inline for classes to read, such as size-(--fab-size)
export type CssVars = Record<`--${string}`, string | number>
