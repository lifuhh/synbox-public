import axios from 'axios'

import type {
  YoutubePlaylistApiResponse,
  YoutubeSearchApiResponse,
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

export async function getLandingPagePlaylist(): Promise<
  formattedYoutubeVideoItemForCarousel[]
> {
  const response = await axios.get<YoutubePlaylistApiResponse>(
    `/api/youtube/playlist/${LANDING_PLAYLIST}`
  )

  const processedResponse = formatYoutubePlaylistResponse(response.data)

  return processedResponse
}

// The chart is 100 songs, two pages of the API's maximum
const CHART_PAGES = 2

export async function getChartsPlaylist(): Promise<
  { title: string; id: string }[]
> {
  const songs: { title: string; id: string }[] = []
  let pageToken: string | undefined
  for (let page = 0; page < CHART_PAGES; page++) {
    const response = await axios.get<YoutubePlaylistApiResponse>(
      `/api/youtube/playlist/${CHARTS_PLAYLIST}`,
      { params: { pageToken } }
    )
    songs.push(...formatYoutubeChartsResponse(response.data))
    pageToken = response.data.nextPageToken
    if (pageToken === undefined) {
      break
    }
  }
  return songs
}

export async function getYoutubeVideoInfo(
  videoId: string
): Promise<YoutubeSearchResultInfo> {
  const response = await axios.get<YoutubeSearchApiResponse>(
    `/api/youtube/video/${encodeURIComponent(videoId)}`
  )

  const songResults = response.data.items

  if (songResults.length === 0) {
    throw new Error('No video found for this video ID')
  }

  const songInfo = songResults[0]
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
