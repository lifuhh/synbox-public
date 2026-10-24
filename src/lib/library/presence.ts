import {
  useGallerySongs,
  useGetLyricsBySongId,
} from '@/lib/react-query/queries-and-mutations'

// Whether a /v/ link's video is a song in Synbox. A song is in the library when its lyrics row exists (the
// backend's test, services/discovery/library.py); the player reads that row anyway, so asking costs nothing.
// The library list answers first when it is already loaded. A lyrics read that fails (offline, Appwrite down)
// can't tell, and the page plays as it always has: the auth Worker refuses the listen of a video it can't find
export type SongPresence = 'checking' | 'in-library' | 'not-in-library'

export const useSongPresence = (videoId: string): SongPresence => {
  const lyrics = useGetLyricsBySongId(videoId)
  const { songs } = useGallerySongs()
  if (lyrics.isError) {
    return 'in-library'
  }
  if (!lyrics.isPending) {
    return lyrics.data === null ? 'not-in-library' : 'in-library'
  }
  return songs.some((song) => song.videoId === videoId)
    ? 'in-library'
    : 'checking'
}
