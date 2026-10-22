import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { currentVideoAtom } from '@/context/atoms'
import { historyAtom } from '@/lib/library/store'
import { useGallerySongs } from '@/lib/react-query/queries-and-mutations'

import type { ListSong } from './model'

// How many songs the More From and Recently Played rows hold
const SHELF = 20

const sameArtist = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

// The artist's other library songs. The artist is the library's name for the song when it is in the library,
// else its channel, which is often the artist's own
export const useArtistSongs = (videoId: string) => {
  const { songs: library } = useGallerySongs()
  const video = useAtomValue(currentVideoAtom)
  return useMemo(() => {
    const artist =
      library.find((song) => song.videoId === videoId)?.author ??
      (video?.videoId === videoId ? video.author : '')
    if (artist.trim() === '') {
      return { artist, songs: [] }
    }
    const songs: ListSong[] = library
      .filter(
        (song) => song.videoId !== videoId && sameArtist(song.author, artist)
      )
      .slice(0, SHELF)
      .map(({ author, thumbnailUrl, title, videoId: id }) => ({
        author,
        thumbnailUrl,
        title,
        videoId: id,
      }))
    return { artist, songs }
  }, [library, video, videoId])
}

// The songs played on this device, latest first, less the one playing
export const useRecentlyPlayed = (videoId: string) => {
  const history = useAtomValue(historyAtom)
  return useMemo(
    (): ListSong[] =>
      history
        .filter((item) => item.videoId !== videoId)
        .slice(0, SHELF)
        .map(({ author, thumbnailUrl, title, videoId: id }) => ({
          author,
          thumbnailUrl,
          title,
          videoId: id,
        })),
    [history, videoId]
  )
}
