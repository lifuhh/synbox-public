import type { QueryClient } from '@tanstack/react-query'
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query'

import { getSongInfoBySongId } from '../appwrite/api'
import { fetchLyricsRow, RateLimitedError } from '../lyrics-api'
import { getLandingPagePlaylist } from '../recommendations'
import { getKaraoke } from '../synbox-flask/api'
import type { LibraryListSong } from '../synbox-flask/discovery'
import {
  getLibrarySongs,
  getSimilarSongs,
  LIBRARY_SONGS_RETRIES,
  libraryRetryDelay,
  searchLibrary,
  searchVideos,
} from '../synbox-flask/discovery'
import {
  activateLyricsVersion,
  getLyricsVersion,
  listLyricsVersions,
} from '../synbox-flask/lyrics-versions'
import { getChartsPlaylist, getYoutubeVideoInfo } from '../youtube/api'
import { QUERY_KEYS } from './query-keys'

const DAY_MS = 1000 * 60 * 60 * 24
const HOUR_MS = 1000 * 60 * 60
// How long a "not yet" answer (no lyrics, no timing) is trusted
const NOT_YET_MS = 1000 * 30

export const useGetLandingPagePlaylist = () =>
  useQuery({
    queryFn: async () => await getLandingPagePlaylist(),
    queryKey: [QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST],
    // One retry, so a rejected API key shows the error and its Retry button in seconds, not ~7s
    retry: 1,
    // A day, like the gallery and charts: each fetch reshuffles, so refetching on every return would reorder the
    // carousel under the user; a tab left open picks up the admin's changes the next day
    staleTime: DAY_MS,
  })

// `enabled: false` reads the chart only if something already fetched it
export const useGetChartsPlaylist = (enabled = true) =>
  useQuery({
    enabled,
    gcTime: 1000 * 60 * 60,
    queryFn: async () => await getChartsPlaylist(),
    queryKey: [QUERY_KEYS.GET_CHARTS_PLAYLIST],
    retry: 1,
    staleTime: DAY_MS,
  })

// A day, so the shuffled order holds while the user browses and a tab left open still gets other people's new
// songs (this tab's own new songs go in at once: setLibrarySong)
export const librarySongs = queryOptions({
  queryFn: getLibrarySongs,
  queryKey: [QUERY_KEYS.GET_GALLERY_SONGS],
  retry: LIBRARY_SONGS_RETRIES,
  retryDelay: libraryRetryDelay,
  staleTime: DAY_MS,
})

export const useGallerySongs = () => {
  const query = useQuery(librarySongs)
  return { ...query, songs: query.data ?? [] }
}

// The lookup service learns of a saved song at its next library refresh (up to 10 minutes, then the edge's
// copy), and this list is read once a visit, so a finished run puts its song in the list itself
export const setLibrarySong = (
  queryClient: QueryClient,
  song: LibraryListSong
) => {
  queryClient.setQueryData(librarySongs.queryKey, (songs) => {
    if (songs === undefined) {
      return songs
    }
    return songs.some((listed) => listed.videoId === song.videoId)
      ? songs.map((listed) =>
          listed.videoId === song.videoId
            ? { ...listed, karaoke: song.karaoke }
            : listed
        )
      : [...songs, song]
  })
}

const karaokeIds = (songs: LibraryListSong[]) =>
  new Set(songs.flatMap((song) => (song.karaoke ? [song.videoId] : [])))

// The songs that play with the karaoke fill (the mic badge), by the library list; no data until it loads
export const useKaraokeIds = () =>
  useQuery({ ...librarySongs, select: karaokeIds })

// The song plays with the karaoke fill, by the library list; false until it loads (or offline)
export const useHasKaraoke = (videoId: string) =>
  useKaraokeIds().data?.has(videoId) ?? false

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

const youtubeVideoInfo = (videoId: string, enabled: boolean) =>
  queryOptions({
    enabled: videoId !== '' && enabled,
    queryFn: async () => await getYoutubeVideoInfo(videoId),
    queryKey: [QUERY_KEYS.GET_YOUTUBE_VIDEO_INFO, videoId],
    // Our proxy keeps a video's details a day; a video that's gone stays gone for this visit
    retry: 1,
    staleTime: DAY_MS,
  })

// YouTube's details for a song with no song_info row
export const useGetYoutubeVideoInfo = (videoId: string) => {
  const { isError } = useGetSongInfoBySongId(videoId)
  return useQuery(youtubeVideoInfo(videoId, isError))
}

// YouTube's details for a video, whatever Synbox knows of it
export const useYoutubeVideo = (videoId: string) =>
  useQuery(youtubeVideoInfo(videoId, true))

export const useGetLyricsBySongId = (songId: string) =>
  useQuery({
    enabled: Boolean(songId?.trim()),
    gcTime: 1000 * 60 * 60,
    queryFn: async ({ signal }) => {
      const found = await fetchLyricsRow(songId, signal)
      return found === null ? null : { ...found.row, videoId: songId }
    },
    queryKey: [QUERY_KEYS.GET_LYRICS_BY_SONG_ID, songId],
    // "No lyrics yet" is asked again on a visit once it is NOT_YET_MS old: anyone's generation can finish in the
    // meantime, and only the listener's own clears the cache (generation-host.tsx). Not on every mount: the page
    // remounts its readers while it checks, and each would ask again
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    // A 404 is the normal "no lyrics yet" answer, so retrying only adds delay
    retry: false,
    staleTime: (query) => (query.state.data === null ? NOT_YET_MS : HOUR_MS),
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
    retry: (failures, error) =>
      !(error instanceof RateLimitedError) && failures < 7,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 20_000),
    // No timing yet goes stale as the lyrics' "not yet" does
    staleTime: (query) => (query.state.data === null ? NOT_YET_MS : HOUR_MS),
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
