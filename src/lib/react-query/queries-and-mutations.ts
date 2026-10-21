import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'

import type { CurrentPlayingInfo } from '@/types'

import {
  addSongInfoBySongId,
  getSongInfoBySongId,
  getSongLyricsById,
  getGallerySongs,
  listGallerySongIds,
  songsWithLyrics,
} from '../appwrite/api'
import type { GallerySong } from '../appwrite/api'
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
import { QUERY_KEYS } from './query-keys'

export const useGetLandingPagePlaylist = () =>
  useQuery({
    queryFn: async () => await getLandingPagePlaylist(),
    queryKey: [QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST],
    // One retry, so a rejected API key shows the error and its Retry button in seconds, not ~7s
    retry: 1,
  })

export const useGetChartsPlaylist = () =>
  useQuery({
    gcTime: 1000 * 60 * 60,
    queryFn: async () => await getChartsPlaylist(),
    queryKey: [QUERY_KEYS.GET_CHARTS_PLAYLIST],
    retry: 1,
    staleTime: 1000 * 60 * 60 * 24,
  })

// Cards are fetched this many at a time, as the gallery scrolls near the end of what it has
export const GALLERY_PAGE = 24

// The ids once a visit, so the shuffled order holds while the user browses; the cards a page at a time
export const useGallerySongs = () => {
  const ids = useQuery({
    queryFn: listGallerySongIds,
    queryKey: [QUERY_KEYS.GET_GALLERY_SONGS, 'ids'],
    staleTime: Infinity,
  })
  const order = ids.data
  const cards = useInfiniteQuery<
    GallerySong[],
    Error,
    InfiniteData<GallerySong[], number>,
    readonly unknown[],
    number
  >({
    enabled: order !== undefined,
    getNextPageParam: (_last, _all, start) =>
      order !== undefined && start + GALLERY_PAGE < order.length
        ? start + GALLERY_PAGE
        : undefined,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<GallerySong[]> =>
      await getGallerySongs(
        (order ?? []).slice(pageParam, pageParam + GALLERY_PAGE)
      ),
    queryKey: [QUERY_KEYS.GET_GALLERY_SONGS, 'cards', order],
    staleTime: Infinity,
  })
  return {
    ...cards,
    isLoading: ids.isLoading || cards.isLoading,
    songs: cards.data?.pages.flat() ?? [],
  }
}

export const useSongsWithLyrics = (videoIds: string[]) =>
  useQuery({
    enabled: videoIds.length > 0,
    queryFn: async () => await songsWithLyrics(videoIds),
    queryKey: [QUERY_KEYS.GET_SONGS_WITH_LYRICS, videoIds],
    staleTime: 1000 * 60 * 10,
  })

export const useGetSongInfoBySongId = (songId: string) =>
  useQuery({
    enabled: !!songId,
    gcTime: 1000 * 60 * 60,
    queryFn: async () => await getSongInfoBySongId(songId),
    queryKey: [QUERY_KEYS.GET_SONG_INFO_BY_SONG_ID, songId],
    // A 404 sends useGetYoutubeVideoInfo to YouTube; retrying would hold the title for seconds
    retry: false,
    staleTime: 1000 * 60 * 60,
  })

export const useGetYoutubeVideoInfo = (videoId: string) => {
  const { isError } = useGetSongInfoBySongId(videoId)

  return useQuery({
    enabled: !!videoId && isError,
    queryFn: async () => await getYoutubeVideoInfo(videoId),
    queryKey: [QUERY_KEYS.GET_YOUTUBE_VIDEO_INFO, videoId],
  })
}

export const useGetLyricsBySongId = (songId: string) =>
  useQuery({
    enabled: Boolean(songId?.trim()),
    gcTime: 1000 * 60 * 60,
    queryFn: async () => await getSongLyricsById(songId),
    queryKey: [QUERY_KEYS.GET_LYRICS_BY_SONG_ID, songId],
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    // A 404 is the normal "no lyrics yet" answer, so retrying only adds delay
    retry: false,
    staleTime: 1000 * 60 * 60,
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
    // A busy server turns requests away for up to a minute while a lyrics job
    // runs; giving up sooner leaves plain lyrics until something remounts
    retry: 7,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 20_000),
    staleTime: 1000 * 60 * 60,
  })

export const useAddSongInfoBySongId = () =>
  useMutation({
    mutationFn: async (songInfo: CurrentPlayingInfo) =>
      await addSongInfoBySongId(songInfo),
  })

export const useSearchVideos = (query: string) =>
  useQuery({
    enabled: query.length > 0,
    queryFn: async ({ signal }) => await searchVideos(query, signal),
    queryKey: [QUERY_KEYS.SEARCH_VIDEOS, query],
    retry: false,
    staleTime: 1000 * 60 * 5,
  })

export const useSearchLibrary = (query: string) =>
  useQuery({
    enabled: query.length > 0,
    queryFn: async ({ signal }) => await searchLibrary(query, signal),
    queryKey: [QUERY_KEYS.SEARCH_LIBRARY, query],
    retry: false,
    staleTime: 1000 * 60 * 5,
  })

export const useGetSimilarSongs = (videoId: string) =>
  useQuery({
    enabled: videoId.length > 0,
    queryFn: async ({ signal }) => await getSimilarSongs(videoId, signal),
    queryKey: [QUERY_KEYS.GET_SIMILAR_SONGS, videoId],
    retry: false,
    staleTime: 1000 * 60 * 10,
  })

export const useGetLyricsVersions = (videoId: string) =>
  useQuery({
    enabled: videoId.length > 0,
    queryFn: async () => await listLyricsVersions(videoId),
    queryKey: [QUERY_KEYS.GET_LYRICS_VERSIONS, videoId],
    retry: false,
  })

export const useGetLyricsVersion = (videoId: string, version: number | null) =>
  useQuery({
    enabled: videoId.length > 0 && version !== null,
    queryFn: async () => await getLyricsVersion(videoId, version ?? 0),
    queryKey: [QUERY_KEYS.GET_LYRICS_VERSION, videoId, version],
    retry: false,
    staleTime: Infinity,
  })

export const useActivateLyricsVersion = () =>
  useMutation({
    mutationFn: async ({
      version,
      videoId,
    }: {
      version: number
      videoId: string
    }) => await activateLyricsVersion(videoId, version),
  })
