import { useMemo } from 'react'

import {
  useGallerySongs,
  useGetSimilarSongs,
} from '@/lib/react-query/queries-and-mutations'

import type { ListSong } from './model'

// How many songs the watch page recommends: the first few are Up Next, the rest More Like This
const RECOMMENDATIONS = 20

// Songs like this one, from the library's similar-songs search. A song not in the library yet has none, so
// it gets library songs instead, in the visit's shuffled order. The playing song is never among them
export const useRecommendations = (videoId: string) => {
  const similar = useGetSimilarSongs(videoId)
  const { songs: library } = useGallerySongs()
  const songs = useMemo((): ListSong[] => {
    const found =
      similar.data?.results.map((song) => ({
        author: song.artist,
        thumbnailUrl: song.thumbnail_url,
        title: song.title,
        videoId: song.video_id,
      })) ?? []
    const pool = found.length > 0 ? found : library
    return pool
      .filter((song) => song.videoId !== videoId)
      .slice(0, RECOMMENDATIONS)
      .map(({ author, thumbnailUrl, title, videoId: id }) => ({
        author,
        thumbnailUrl,
        title,
        videoId: id,
      }))
  }, [similar.data, library, videoId])
  return { loading: similar.isLoading && library.length === 0, songs }
}
