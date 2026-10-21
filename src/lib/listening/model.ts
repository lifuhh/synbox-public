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

// What plays when `current` ends: the queue's first song (taken off the queue), else, with autoplay on, the
// first recommendation that is neither playing nor among `recent`; null when there is nothing to play
export const nextSong = (
  state: ListeningState,
  current: string,
  recommendations: ListSong[],
  recent: string[]
): { song: ListSong; queue: ListSong[] } | null => {
  const queue = without(state.queue, current)
  if (queue.length > 0) {
    const [song, ...rest] = queue
    return { queue: rest, song }
  }
  if (!state.autoplay) {
    return null
  }
  const skip = new Set([current, ...recent])
  const song = recommendations.find((candidate) => !skip.has(candidate.videoId))
  return song === undefined ? null : { queue, song }
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
