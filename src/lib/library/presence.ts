import { justMade } from '@/lib/generation/store'
import {
  useGallerySongs,
  useGetChartsPlaylist,
  useGetLyricsBySongId,
} from '@/lib/react-query/queries-and-mutations'

// What a /v/ link's video is to Synbox. A song is in the library when its lyrics row exists (the backend's test,
// services/discovery/library.py); the player reads that row anyway, so asking costs nothing, and the library
// list answers first when it is already loaded. A lyrics read that fails (offline, Appwrite down) can't tell, and
// the page plays as it always has: the auth Worker refuses the listen of a video it can't find.
// A video outside the library that is in YouTube's Top 100 Japan (the home page's chart, read only for these) is a
// chart song: it plays, with Generate Lyrics, and nothing about it is kept until it is generated
export type SongPresence =
  | { kind: 'checking' }
  | { kind: 'in-library' }
  | { kind: 'chart-song'; rank: number }
  | { kind: 'not-in-library' }

export const useSongPresence = (videoId: string): SongPresence => {
  const lyrics = useGetLyricsBySongId(videoId)
  const { songs } = useGallerySongs()
  const outside = !lyrics.isPending && !lyrics.isError && lyrics.data === null
  const chart = useGetChartsPlaylist(outside)
  if (lyrics.isError) {
    return { kind: 'in-library' }
  }
  if (lyrics.isPending) {
    return songs.some((song) => song.videoId === videoId)
      ? { kind: 'in-library' }
      : { kind: 'checking' }
  }
  if (lyrics.data !== null) {
    return { kind: 'in-library' }
  }
  // A cached "not yet" being asked again: the song may have arrived since. A song this browser just finished is
  // waited for (its lyrics query asks again until it arrives) rather than shown as missing
  if (lyrics.isFetching || justMade(videoId)) {
    return songs.some((song) => song.videoId === videoId)
      ? { kind: 'in-library' }
      : { kind: 'checking' }
  }
  if (chart.isPending) {
    return { kind: 'checking' }
  }
  const charted = chart.data?.find((song) => song.id === videoId)
  return charted === undefined
    ? { kind: 'not-in-library' }
    : { kind: 'chart-song', rank: charted.rank }
}
