import { z } from 'zod'

import type {
  YoutubeSearchResultInfo,
  formattedYoutubeVideoItemForCarousel,
} from '@/types'
import {
  formatYoutubeChartsResponse,
  formatYoutubePlaylistResponse,
} from '@/utils'

// YouTube Data API reads go through our own /api/youtube proxy, which holds the key
const LANDING_PLAYLIST = 'PLzJ1mqwxogpFxKR72a6M8br_UkLKFQASf'
const CHARTS_PLAYLIST = 'PL4fGSI1pDJn4-UIb6RKHdxam-oAUULIGB'

const thumbnailSchema = z.object({ url: z.string() }).optional()
// Empty for a private or deleted video in a playlist
const thumbnailsSchema = z.object({
  default: thumbnailSchema,
  high: thumbnailSchema,
  maxres: thumbnailSchema,
  medium: thumbnailSchema,
  standard: thumbnailSchema,
})

// Only the fields the app reads. A private video has no owner channel, so a missing one becomes ''
const playlistSchema = z.object({
  items: z.array(
    z.object({
      snippet: z.object({
        description: z.string().default(''),
        resourceId: z.object({ videoId: z.string() }),
        thumbnails: thumbnailsSchema,
        title: z.string(),
        videoOwnerChannelTitle: z.string().default(''),
      }),
    })
  ),
  nextPageToken: z.string().optional(),
})
export type YoutubePlaylist = z.infer<typeof playlistSchema>

// A channel can hide its like count, so a missing count becomes ''
const countSchema = z.string().default('')
const videoSchema = z.object({
  items: z.array(
    z.object({
      contentDetails: z.object({ duration: z.string() }).optional(),
      id: z.string(),
      snippet: z.object({
        channelTitle: z.string(),
        defaultAudioLanguage: z.string().optional(),
        description: z.string().default(''),
        tags: z.array(z.string()).optional(),
        thumbnails: thumbnailsSchema.optional(),
        title: z.string(),
      }),
      statistics: z
        .object({
          commentCount: countSchema,
          likeCount: countSchema,
          viewCount: countSchema,
        })
        .optional(),
    })
  ),
})

const getYoutube = async <T>(
  schema: z.ZodType<T>,
  path: string,
  params: Record<string, string | undefined> = {}
): Promise<T> => {
  const query = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  ).toString()
  const response = await fetch(query === '' ? path : `${path}?${query}`)
  if (!response.ok) {
    throw new Error(`YouTube request failed (HTTP ${response.status})`)
  }
  const body: unknown = await response.json()
  return schema.parse(body)
}

const resolutionOrder = [
  'maxres',
  'standard',
  'high',
  'medium',
  'default',
] as const

const getHighestResThumbnail = (
  thumbnails:
    | Partial<Record<(typeof resolutionOrder)[number], { url: string }>>
    | undefined
): string => {
  for (const res of resolutionOrder) {
    const url = thumbnails?.[res]?.url
    if (url !== undefined && url !== '') {
      return url
    }
  }

  return 'https://example.com/placeholder-thumbnail.jpg'
}

export const getLandingPagePlaylist = async (): Promise<
  formattedYoutubeVideoItemForCarousel[]
> => {
  const playlist = await getYoutube(
    playlistSchema,
    `/api/youtube/playlist/${LANDING_PLAYLIST}`
  )

  const processedResponse = formatYoutubePlaylistResponse(playlist)

  return processedResponse
}

// The chart is 100 songs, two pages of the API's maximum
const CHART_PAGES = 2

export const getChartsPlaylist = async (): Promise<
  { title: string; id: string }[]
> => {
  const songs: { title: string; id: string }[] = []
  let pageToken: string | undefined
  for (let page = 0; page < CHART_PAGES; page += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page needs the previous page's token
    const playlist = await getYoutube(
      playlistSchema,
      `/api/youtube/playlist/${CHARTS_PLAYLIST}`,
      { pageToken }
    )
    songs.push(...formatYoutubeChartsResponse(playlist))
    pageToken = playlist.nextPageToken
    if (pageToken === undefined) {
      break
    }
  }
  return songs
}

export const getYoutubeVideoInfo = async (
  videoId: string
): Promise<YoutubeSearchResultInfo> => {
  const video = await getYoutube(
    videoSchema,
    `/api/youtube/video/${encodeURIComponent(videoId)}`
  )

  const songResults = video.items

  if (songResults.length === 0) {
    throw new Error('No video found for this video ID')
  }

  const [songInfo] = songResults
  const duration = songInfo.contentDetails?.duration
  const songData = {
    channelTitle: songInfo.snippet.channelTitle,
    defaultAudioLanguage: songInfo.snippet.defaultAudioLanguage ?? '',
    description: songInfo.snippet.description,
    duration: duration === undefined || duration === '' ? '-1' : duration,
    id: songInfo.id,
    statistics: songInfo.statistics,
    tags: songInfo.snippet.tags ?? [],
    thumbnail: getHighestResThumbnail(songInfo.snippet.thumbnails),
    title: songInfo.snippet.title,
  }

  return songData
}
