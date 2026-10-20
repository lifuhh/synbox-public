import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from '@tanstack/react-query'

export interface formattedYoutubeVideoItemForCarousel {
  title: string
  channel: string
  description: string
  thumbnailUrl: string
  videoId: string
}

export interface YoutubePlaylistApiResponse {
  kind: string
  etag: string
  nextPageToken?: string
  items: YoutubePlaylistItem[]
  pageInfo: PageInfo
}

export interface YoutubePlaylistItem {
  kind: string
  etag: string
  id: string
  snippet: YoutubePlaylistItemSnippet
}

interface YoutubePlaylistItemSnippet {
  publishedAt: string
  channelId: string
  title: string
  description: string
  thumbnails: Thumbnails
  channelTitle: string
  playlistId: string
  position: number
  resourceId: ResourceId
  videoOwnerChannelTitle: string
  videoOwnerChannelId: string
}

// Empty for a private or deleted video in a playlist
interface Thumbnails {
  default?: ThumbnailInfo
  medium?: ThumbnailInfo
  high?: ThumbnailInfo
  standard?: ThumbnailInfo
  maxres?: ThumbnailInfo
}

interface ThumbnailInfo {
  url: string
  width: number
  height: number
}

interface ResourceId {
  kind: string
  videoId: string
}

interface PageInfo {
  totalResults: number
  resultsPerPage: number
}

export interface YoutubeSearchApiResponse {
  kind: string
  etag: string
  nextPageToken?: string
  regionCode?: string
  items: YoutubeSearchItem[]
  pageInfo: PageInfo
}

interface YoutubeVideoStatistics {
  viewCount: string
  likeCount: string
  commentCount: string
}

interface YoutubeSearchItem {
  kind: string
  etag: string
  id:
    | string
    | {
        videoId: string
        kind: string
      }
  snippet: YoutubeSearchItemSnippet
  contentDetails?: {
    duration: string
  }
  statistics?: YoutubeVideoStatistics
}

interface YoutubeSearchItemSnippet {
  publishedAt: string
  channelId: string
  title: string
  description: string
  thumbnails?: Thumbnails
  channelTitle: string
  liveBroadcastContent: string
  publishTime: string
  tags?: string[]
  defaultAudioLanguage?: string
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

interface FullVideoInfo {
  id: string
  thumbnail: string
  duration: number
  likes: number
  playable_in_embed: boolean
  title: string
  channel_name: string
}

interface VideoInfoForValidation {
  title: string
  channel_name: string
}

export interface SubtitleInfo {
  exist: boolean
  path: string | null
  ext: string | null
}

export interface VideoInfo {
  passed: boolean
  audio_file_path: string
  full_vid_info: FullVideoInfo
  vid_info_for_validation: VideoInfoForValidation
  subtitle_info: SubtitleInfo
  error_msg: string | null
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
