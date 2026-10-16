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

  if (!response) {
    throw new Error('Failed to fetch playlist items')
  }

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

  if (!response) {
    throw new Error('Failed to fetch playlist items')
  }

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

  if (!response) {
    throw new Error('Failed to fetch playlist items')
  }

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

  if (!response) {
    throw new Error('Failed to fetch video info')
  }

  const songResults = response.data.items

  if (songResults.length === 0) {
    throw new Error('No video found for this video ID')
  }

  const songInfo = songResults[0]
  const songData = {
    id: songInfo.id,
    title: songInfo.snippet.title,
    channelTitle: songInfo.snippet.channelTitle,
    description: songInfo.snippet.description,
    tags: songInfo.snippet.tags || [],
    defaultAudioLanguage: songInfo.snippet.defaultAudioLanguage || '',
    thumbnail: getHighestResThumbnail(songInfo.snippet.thumbnails),
    duration: songInfo.contentDetails?.duration || '-1',
    statistics: songInfo.statistics,
  }

  return songData
}

function getHighestResThumbnail(thumbnails: any) {
  const resolutionOrder = ['maxres', 'standard', 'high', 'medium', 'default']

  for (const res of resolutionOrder) {
    if (thumbnails[res] && thumbnails[res].url) {
      return thumbnails[res].url
    }
  }

  return 'https://example.com/placeholder-thumbnail.jpg'
}
