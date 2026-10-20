import { useMutation, useQuery } from '@tanstack/react-query'

import type { CurrentPlayingInfo } from '@/types'

import {
  addSongInfoBySongId,
  getSongInfoBySongId,
  getSongLyricsById,
  listGallerySongs,
  songsWithLyrics,
} from '../appwrite/api'
import { getKaraoke } from '../synbox-flask/api'
import {
  getSimilarSongs,
  searchLibrary,
  searchVideos,
} from '../synbox-flask/discovery'
import {
  activateLyricsVersion,
  getLyricsVersion,
  listLyricsVersions,
} from '../synbox-flask/lyrics-versions'
import {
  getChartsPlaylist,
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

// Fetched once a visit, so the shuffled order holds while the user browses
export const useGetGallerySongs = () =>
  useQuery({
    queryKey: [QUERY_KEYS.GET_GALLERY_SONGS],
    queryFn: listGallerySongs,
    staleTime: Infinity,
  })

export const useSongsWithLyrics = (videoIds: string[]) =>
  useQuery({
    queryKey: [QUERY_KEYS.GET_SONGS_WITH_LYRICS, videoIds],
    queryFn: () => songsWithLyrics(videoIds),
    enabled: videoIds.length > 0,
    staleTime: 1000 * 60 * 10,
  })

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

// data is null when the song has no karaoke timing yet. A previewed version
// saved before timing was stored per version falls back to the live timing,
// which the player only uses when its lines match.
export const useGetKaraokeById = (
  videoId: string,
  version: number | null = null
) =>
  useQuery({
    enabled: videoId.trim().length > 0,
    gcTime: 1000 * 60 * 60,
    queryFn: async ({ signal }) =>
      version === null
        ? await getKaraoke(videoId, null, signal)
        : ((await getKaraoke(videoId, version, signal)) ??
          (await getKaraoke(videoId, null, signal))),
    queryKey: [QUERY_KEYS.GET_KARAOKE_BY_ID, videoId, version],
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 1000 * 60 * 60,
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
    // A 404 sends useGetYoutubeVideoInfo to YouTube; retrying would hold the title for seconds
    retry: false,
    queryFn: () => getSongInfoBySongId(songId),
  })

export const useSearchVideos = (query: string) =>
  useQuery({
    queryKey: [QUERY_KEYS.SEARCH_VIDEOS, query],
    queryFn: ({ signal }) => searchVideos(query, signal),
    enabled: query.length > 0,
    staleTime: 1000 * 60 * 5,
    retry: false,
  })

export const useSearchLibrary = (query: string) =>
  useQuery({
    queryKey: [QUERY_KEYS.SEARCH_LIBRARY, query],
    queryFn: ({ signal }) => searchLibrary(query, signal),
    enabled: query.length > 0,
    staleTime: 1000 * 60 * 5,
    retry: false,
  })

export const useGetSimilarSongs = (videoId: string) =>
  useQuery({
    queryKey: [QUERY_KEYS.GET_SIMILAR_SONGS, videoId],
    queryFn: ({ signal }) => getSimilarSongs(videoId, signal),
    enabled: videoId.length > 0,
    staleTime: 1000 * 60 * 10,
    retry: false,
  })

export const useGetLyricsVersions = (videoId: string) =>
  useQuery({
    enabled: videoId.length > 0,
    queryFn: () => listLyricsVersions(videoId),
    queryKey: [QUERY_KEYS.GET_LYRICS_VERSIONS, videoId],
    retry: false,
  })

export const useGetLyricsVersion = (videoId: string, version: number | null) =>
  useQuery({
    enabled: videoId.length > 0 && version !== null,
    queryFn: () => getLyricsVersion(videoId, version ?? 0),
    queryKey: [QUERY_KEYS.GET_LYRICS_VERSION, videoId, version],
    retry: false,
    staleTime: Infinity,
  })

export const useActivateLyricsVersion = () =>
  useMutation({
    mutationFn: ({
      adminToken,
      version,
      videoId,
    }: {
      adminToken: string
      version: number
      videoId: string
    }) => activateLyricsVersion(videoId, version, adminToken),
  })
