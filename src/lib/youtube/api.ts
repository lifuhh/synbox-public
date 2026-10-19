import axios from 'axios'

import type {
  FetchInfiniteGalleryPlaylistParams,
  YoutubePlaylistApiResponse,
  YoutubeSearchApiResponse,
  YoutubeSearchResultInfo,
  formattedYoutubeVideoItemForCarousel,
} from '@/types'
import {
  formatYoutubeChartsResponse,
  formatYoutubePlaylistResponse,
} from '@/utils'

const YoutubeApiKey = import.meta.env.VITE_GOOGLE_API_KEY

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
    `https://www.googleapis.com/youtube/v3/playlistItems`,
    {
      params: {
        key: YoutubeApiKey,
        part: 'snippet',
        playlistId: 'PLzJ1mqwxogpFxKR72a6M8br_UkLKFQASf',
        maxResults: 50,
      },
    }
  )

  const processedResponse = formatYoutubePlaylistResponse(response.data)

  return processedResponse
}

export async function getChartsPlaylist(): Promise<
  { title: string; id: string }[]
> {
  const response = await axios.get<YoutubePlaylistApiResponse>(
    `https://www.googleapis.com/youtube/v3/playlistItems`,
    {
      params: {
        key: YoutubeApiKey,
        part: 'snippet',
        playlistId: 'PL4fGSI1pDJn4-UIb6RKHdxam-oAUULIGB',
        maxResults: 50,
      },
    }
  )

  const processedResponse = formatYoutubeChartsResponse(response.data)

  return processedResponse
}

export const getInfiniteGalleryPlaylist = async ({
  pageParam = '',
}: FetchInfiniteGalleryPlaylistParams): Promise<YoutubePlaylistApiResponse> => {
  const response = await axios.get<YoutubePlaylistApiResponse>(
    `https://www.googleapis.com/youtube/v3/playlistItems`,
    {
      params: {
        key: YoutubeApiKey,
        part: 'snippet',
        playlistId: 'PLzJ1mqwxogpHcS_hfWcEY_o8n_yBeGlAN',
        maxResults: 12,
        pageToken: pageParam,
      },
    }
  )

  return response.data
}

export async function getYoutubeVideoInfo(
  videoId: string
): Promise<YoutubeSearchResultInfo> {
  const response = await axios.get<YoutubeSearchApiResponse>(
    `https://www.googleapis.com/youtube/v3/videos`,
    {
      params: {
        key: YoutubeApiKey,
        part: 'snippet,statistics,contentDetails',
        id: videoId,
      },
    }
  )

  const songResults = response.data.items

  if (songResults.length === 0) {
    throw new Error('No video found for this video ID')
  }

  const songInfo = songResults[0]
  const duration = songInfo.contentDetails?.duration
  const songData = {
    id: songInfo.id,
    title: songInfo.snippet.title,
    channelTitle: songInfo.snippet.channelTitle,
    description: songInfo.snippet.description,
    tags: songInfo.snippet.tags ?? [],
    defaultAudioLanguage: songInfo.snippet.defaultAudioLanguage ?? '',
    thumbnail: getHighestResThumbnail(songInfo.snippet.thumbnails),
    duration: duration === undefined || duration === '' ? '-1' : duration,
    statistics: songInfo.statistics,
  }

  return songData
}
