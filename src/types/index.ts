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

interface Thumbnails {
  default: ThumbnailInfo
  medium: ThumbnailInfo
  high: ThumbnailInfo
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

export interface InfiniteGalleryVideoItem {
  title: string
  channel: string
  thumbnailUrl: string
  videoId: string
}

export interface TransformedYoutubePlaylistPage {
  items: InfiniteGalleryVideoItem[]
  nextPageToken?: string
}

export type InfiniteGalleryQueryResult = UseInfiniteQueryResult<
  InfiniteData<TransformedYoutubePlaylistPage>
>

export interface FetchInfiniteGalleryPlaylistParams {
  pageParam?: string
}

export type FormatYoutubeResponseFunction = (
  data: YoutubePlaylistApiResponse
) => InfiniteGalleryVideoItem[]

export interface InfiniteScrollGalleryProps {
  items: InfiniteGalleryVideoItem[]
  className?: string
  fetchNextPage: () => void
  hasNextPage: boolean | undefined
  isFetchingNextPage: boolean
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
