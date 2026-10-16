import type { InfiniteData } from '@tanstack/react-query'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useRef } from 'react'

import type {
  CurrentPlayingInfo,
  InfiniteGalleryQueryResult,
  TransformedYoutubePlaylistPage,
  YoutubePlaylistApiResponse,
} from '@/types'
import { delayApiResponse, formatYoutubeInfiniteGalleryResponse } from '@/utils'

import {
  addSongInfoBySongId,
  getSongInfoBySongId,
  getSongLyricsById,
  uploadLyricsToAppwrite,
} from '../appwrite/api'
import {
  getChartsPlaylist,
  getInfiniteGalleryPlaylist,
  getLandingPagePlaylist,
  getYoutubeVideoInfo,
} from '../youtube/api'
import { QUERY_KEYS } from './queryKeys'

export const useGetLandingPagePlaylist = () =>
  useQuery({
    queryKey: [QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST],
    queryFn: () => getLandingPagePlaylist(),
  })

export const useGetChartsPlaylist = () =>
  useQuery({
    queryKey: [QUERY_KEYS.GET_CHARTS_PLAYLIST],
    queryFn: () => getChartsPlaylist(),
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60,
  })

export const useGetInfiniteGalleryPlaylist = (): InfiniteGalleryQueryResult => {
  const isFirstLoad = useRef(true)

  return useInfiniteQuery<
    YoutubePlaylistApiResponse,
    Error,
    InfiniteData<TransformedYoutubePlaylistPage>,
    [string],
    string
  >({
    queryKey: [QUERY_KEYS.GET_INFINITE_GALLERY_PLAYLIST],
    queryFn: async ({ pageParam = '' }) => {
      const result = await getInfiniteGalleryPlaylist({ pageParam })

      if (!isFirstLoad.current) {
        const randomDelay = Math.floor(Math.random() * (350 - 220 + 1) + 220)
        await delayApiResponse(randomDelay)
      } else {
        isFirstLoad.current = false
      }

      return result
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,

    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: 'always',
    select: (data) => ({
      pages: data.pages.map((page) => ({
        items: formatYoutubeInfiniteGalleryResponse(page),
        nextPageToken: page.nextPageToken,
      })),
      pageParams: data.pageParams,
    }),
  })
}

export const useGetYoutubeVideoInfo = (videoId: string) => {
  const { isError } = useGetSongInfoBySongId(videoId)

  return useQuery({
    queryKey: [QUERY_KEYS.GET_YOUTUBE_VIDEO_INFO, videoId],
    queryFn: () => getYoutubeVideoInfo(videoId),
    enabled: !!videoId && isError,
  })
}

export const useGetLyricsBySongId = (songId: string) =>
  useQuery({
    queryKey: [QUERY_KEYS.GET_LYRICS_BY_SONG_ID, songId],
    enabled: Boolean(songId?.trim()),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    // A 404 is the normal "no lyrics yet" answer, so retrying only adds delay
    retry: false,
    queryFn: () => getSongLyricsById(songId),
  })

export const useAddSongInfoBySongId = () =>
  useMutation({
    mutationFn: (songInfo: CurrentPlayingInfo) => addSongInfoBySongId(songInfo),
  })

export const useGetSongInfoBySongId = (songId: string) =>
  useQuery({
    queryKey: [QUERY_KEYS.GET_SONG_INFO_BY_SONG_ID, songId],
    enabled: !!songId,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    queryFn: () => getSongInfoBySongId(songId),
  })

interface LyricsDataInterface {
  full_lyrics: string
  plain_lyrics: string
  romaji: string
  eng_translation: string
  chi_translation: string
  labelled_full_lyrics: string
}
export const useUploadLyricsToAppwrite = () =>
  useMutation({
    mutationFn: ({
      songId,
      lyricsData,
    }: {
      songId: string
      lyricsData: LyricsDataInterface
    }) => uploadLyricsToAppwrite(songId, lyricsData),
  })
