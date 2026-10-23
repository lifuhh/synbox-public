import type { CurrentPlayingInfo } from '@/types'

// What the listening features keep about a song: enough to show it in a list and open it
export type ListSong = CurrentPlayingInfo

export interface Playlist {
  id: string
  name: string
  songs: ListSong[]
  createdAt: number
  updatedAt: number
}

// Where the songs in the queue came from, shown over Up Next ("Playing From …")
export type QueueSource = { kind: 'playlist'; id: string; name: string } | null

export interface ListeningState {
  // Songs the listener lined up, played before any recommendation, first one next
  queue: ListSong[]
  source: QueueSource
  // When the queue runs out, the next recommendation plays
  autoplay: boolean
}

// A song is in a list at most once: adding one already there leaves the list as it was
const without = (songs: ListSong[], videoId: string) =>
  songs.filter((song) => song.videoId !== videoId)

export const addToQueue = (queue: ListSong[], song: ListSong) =>
  queue.some((queued) => queued.videoId === song.videoId)
    ? queue
    : [...queue, song]

// Play Next: to the front, moved there if it was already queued
export const playNext = (queue: ListSong[], song: ListSong) => [
  song,
  ...without(queue, song.videoId),
]

export const removeSong = (songs: ListSong[], videoId: string) =>
  without(songs, videoId)

// Moves the item at `from` to `to`, the others keeping their order; out-of-range indexes change nothing
export const move = <T>(items: T[], from: number, to: number): T[] => {
  if (
    from === to ||
    from < 0 ||
    from >= items.length ||
    to < 0 ||
    to >= items.length
  ) {
    return items
  }
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// What plays when `current` ends, or when Next is pressed: the queue's first song (taken off the queue), else
// the first recommendation that is neither playing nor among `recent`; null when there is nothing to play. A
// song that ends goes on to a recommendation only with autoplay on; a press always does
export const nextSong = (
  state: ListeningState,
  current: string,
  recommendations: ListSong[],
  recent: string[],
  pressed = false
): { song: ListSong; queue: ListSong[] } | null => {
  const queue = without(state.queue, current)
  if (queue.length > 0) {
    const [song, ...rest] = queue
    return { queue: rest, song }
  }
  if (!state.autoplay && !pressed) {
    return null
  }
  const skip = new Set([current, ...recent])
  const song = recommendations.find((candidate) => !skip.has(candidate.videoId))
  return song === undefined ? null : { queue, song }
}

// The songs played before the current one in this visit, the latest last: Previous walks back through them
const PLAYED_KEEP = 50

// A song left for another one goes on top of the trail
export const leftSong = (played: ListSong[], song: ListSong) =>
  played.at(-1)?.videoId === song.videoId
    ? played
    : [...played, song].slice(-PLAYED_KEEP)

// Previous: the song played before `current`, taken off the trail, with `current` put first in the queue so
// Next comes back to it; null when nothing was played before it
export const previousSong = (
  played: ListSong[],
  queue: ListSong[],
  current: ListSong
): { song: ListSong; played: ListSong[]; queue: ListSong[] } | null => {
  const trail = played.filter((song) => song.videoId !== current.videoId)
  const song = trail.at(-1)
  return song === undefined
    ? null
    : { played: trail.slice(0, -1), queue: playNext(queue, current), song }
}

export const newPlaylist = (
  name: string,
  songs: ListSong[],
  now: number,
  id: string
): Playlist => ({
  createdAt: now,
  id,
  name: name.trim() === '' ? 'New Playlist' : name.trim(),
  songs,
  updatedAt: now,
})

export const addToPlaylist = (
  playlist: Playlist,
  song: ListSong,
  now: number
): Playlist =>
  playlist.songs.some((saved) => saved.videoId === song.videoId)
    ? playlist
    : { ...playlist, songs: [...playlist.songs, song], updatedAt: now }

// Playing a playlist from one of its songs: that song plays now and the songs after it fill the queue
export const playFrom = (playlist: Playlist, index: number) => ({
  queue: playlist.songs.slice(index + 1),
  song: playlist.songs[index],
  source: { id: playlist.id, kind: 'playlist', name: playlist.name } as const,
})
