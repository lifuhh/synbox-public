import { atom, useAtom, useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { currentVideoAtom } from '@/context/atoms'
import {
  useGallerySongs,
  useGetSimilarSongs,
} from '@/lib/react-query/queries-and-mutations'

import type { ListSong } from './model'
import type { NextFilter, SongFacets } from './next-filter'
import {
  ALL,
  applyFilter,
  filterKey,
  nextFilters,
  sameArtist,
} from './next-filter'
import { useArtistSongs } from './shelves'

// How many songs the watch page lists beside the video and under it
const RECOMMENDATIONS = 30

// Songs like this one, from the library's similar-songs search (same artist, then mood, then kind of singer),
// then library songs in the visit's shuffled order to fill the list. A song not in the library yet has only
// those. The playing song is never among them
export const useRecommendations = (videoId: string) => {
  const similar = useGetSimilarSongs(videoId)
  const { songs: library } = useGallerySongs()
  return useMemo(() => {
    const results = similar.data?.results ?? []
    const facets = new Map<string, SongFacets>(
      results.map((song) => [
        song.video_id,
        { artist: song.artist, mood: song.mood, vocal: song.vocal },
      ])
    )
    const found: ListSong[] = results.map((song) => ({
      author: song.artist,
      thumbnailUrl: song.thumbnail_url,
      title: song.title,
      videoId: song.video_id,
    }))
    const songs = [
      ...found,
      ...library.filter((song) => !facets.has(song.videoId)),
    ]
      .filter((song) => song.videoId !== videoId)
      .slice(0, RECOMMENDATIONS)
      .map(({ author, thumbnailUrl, title, videoId: id }) => ({
        author,
        thumbnailUrl,
        title,
        videoId: id,
      }))
    const playing = similar.data?.song
    const current: SongFacets | null =
      playing === null || playing === undefined
        ? null
        : { artist: playing.artist, mood: playing.mood, vocal: playing.vocal }
    return {
      current,
      facets,
      loading: similar.isLoading && library.length === 0,
      songs,
    }
  }, [similar.data, similar.isLoading, library, videoId])
}

// The chip picked over the list, for the song it was picked on. A new song starts at All, unless the artist's chip
// was picked and the new song is theirs too: that chip stays until the listener turns it off
const nextFilterAtom = atom<{ videoId: string; filter: NextFilter } | null>(
  null
)

// The list beside the video as the listener filtered it. Autoplay reads the same list, so the song at its top
// is the one that plays next. The artist's chip lists their library songs too, not only those recommended
export const useNextList = (videoId: string) => {
  const { current, facets, loading, songs } = useRecommendations(videoId)
  const { songs: byArtist } = useArtistSongs(videoId)
  const video = useAtomValue(currentVideoAtom)
  const [chosen, setChosen] = useAtom(nextFilterAtom)
  // A song outside the library has no tags, but its channel still finds the artist's other songs
  const playing =
    current ??
    (video?.videoId === videoId && video.author !== ''
      ? { artist: video.author, mood: null, vocal: 'unknown' }
      : null)
  const listed = new Set(songs.map((song) => song.videoId))
  const withArtist = [
    ...songs,
    ...byArtist.filter((song) => !listed.has(song.videoId)),
  ]
  const filters = nextFilters(playing, withArtist, facets)
  const stillTheirs =
    chosen?.filter.kind === 'artist' &&
    playing !== null &&
    sameArtist(chosen.filter.artist, playing.artist)
  const carried: NextFilter = stillTheirs
    ? { artist: playing.artist, kind: 'artist' }
    : ALL
  const picked = chosen?.videoId === videoId ? chosen.filter : carried
  const filter =
    filters.find((option) => filterKey(option) === filterKey(picked)) ?? ALL
  return {
    all: songs,
    filter,
    filters,
    loading,
    setFilter: (next: NextFilter) => {
      setChosen({ filter: next, videoId })
    },
    songs:
      filter.kind === 'all' ? songs : applyFilter(filter, withArtist, facets),
  }
}
