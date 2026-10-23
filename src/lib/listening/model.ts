import type { CurrentPlayingInfo } from '@/types'

import type { Random } from './shuffle'
import { spreadShuffle } from './shuffle'

// What the listening features keep about a song: enough to show it in a list and open it
export type ListSong = CurrentPlayingInfo

export interface Playlist {
  id: string
  name: string
  songs: ListSong[]
  createdAt: number
  updatedAt: number
}

// A playlist being played through, as Spotify keeps what you play from apart from your queue: the songs you add
// play first, then the playlist goes on where it was
export interface PlayContext {
  kind: 'playlist'
  id: string
  name: string
  // Its songs in the order they play: as listed, or shuffled. A snapshot: edits to the playlist apply the next
  // time it is played
  order: ListSong[]
  shuffled: boolean
  // The song of `order` playing now, or the last one played before a queued song; -1 before the first
  at: number
}

export interface ListeningState {
  // Songs the listener lined up, played before anything else, first one next
  queue: ListSong[]
  // The playlist being played, after the queue
  context: PlayContext | null
  // When both run out, the next recommendation plays
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

interface Step {
  song: ListSong
  queue: ListSong[]
  context: PlayContext | null
}

// What plays when `current` ends, or when Next is pressed: the queue's first song (taken off the queue), else
// the playlist's next song, else the first recommendation that is neither playing nor among `recent` (the
// playlist is then over); null when there is nothing to play. A song that ends goes on to a recommendation only
// with autoplay on; a press always does
export const nextSong = (
  state: ListeningState,
  current: string,
  recommendations: ListSong[],
  recent: string[],
  pressed = false
): Step | null => {
  const queue = without(state.queue, current)
  if (queue.length > 0) {
    const [song, ...rest] = queue
    return { context: state.context, queue: rest, song }
  }
  const { context } = state
  if (context !== null) {
    const at = context.order.findIndex(
      (song, index) => index > context.at && song.videoId !== current
    )
    if (at !== -1) {
      return { context: { ...context, at }, queue, song: context.order[at] }
    }
  }
  if (!state.autoplay && !pressed) {
    return null
  }
  const skip = new Set([current, ...recent])
  const song = recommendations.find((candidate) => !skip.has(candidate.videoId))
  return song === undefined ? null : { context: null, queue, song }
}

// The songs played before the current one in this visit, the latest last: Previous walks back through them
const PLAYED_KEEP = 50

// A song left for another one goes on top of the trail
export const leftSong = (played: ListSong[], song: ListSong) =>
  played.at(-1)?.videoId === song.videoId
    ? played
    : [...played, song].slice(-PLAYED_KEEP)

// Previous: the song played before `current`, taken off the trail; null when nothing was played before it. Next
// then comes back to `current`: a playlist's song by stepping the playlist back before it, any other song by
// putting it first in the queue
export const previousSong = (
  played: ListSong[],
  state: Pick<ListeningState, 'queue' | 'context'>,
  current: ListSong
): (Step & { played: ListSong[] }) | null => {
  const trail = played.filter((song) => song.videoId !== current.videoId)
  const song = trail.at(-1)
  if (song === undefined) {
    return null
  }
  const { context, queue } = state
  const at =
    context?.order.findIndex((listed) => listed.videoId === current.videoId) ??
    -1
  return context !== null && at >= 0
    ? {
        context: { ...context, at: at - 1 },
        played: trail.slice(0, -1),
        queue,
        song,
      }
    : {
        context,
        played: trail.slice(0, -1),
        queue: playNext(queue, current),
        song,
      }
}

// The playlist after a song opens: a song of the playlist becomes its place; a song from the queue, or one
// Previous went back to (`kept`), leaves it waiting; any other song the listener picked ends it
export const followSong = (
  context: PlayContext | null,
  videoId: string,
  kept: boolean
): PlayContext | null => {
  if (context === null) {
    return null
  }
  const at = context.order.findIndex((song) => song.videoId === videoId)
  if (at === -1) {
    return kept ? context : null
  }
  return at === context.at ? context : { ...context, at }
}

const artistOf = (song: ListSong) => song.author

// Playing a playlist: in its order from one of its songs, or shuffled. A shuffle starts from the song picked, if
// one was, and plays every other song once in an order no two shuffles share (shuffle › spreadShuffle)
export const playPlaylist = (
  playlist: Playlist,
  { from, shuffled }: { from?: number; shuffled: boolean },
  random: Random
): PlayContext => {
  const base = {
    id: playlist.id,
    kind: 'playlist',
    name: playlist.name,
  } as const
  if (!shuffled) {
    return { ...base, at: from ?? 0, order: playlist.songs, shuffled }
  }
  const start = from === undefined ? undefined : playlist.songs[from]
  const rest = spreadShuffle(
    start === undefined
      ? playlist.songs
      : without(playlist.songs, start.videoId),
    artistOf,
    random
  )
  return {
    ...base,
    at: 0,
    order: start === undefined ? rest : [start, ...rest],
    shuffled,
  }
}

// Shuffle turned on or off while a playlist plays: the songs already played keep their places and a new shuffle
// of the rest follows; off, the playlist's own order goes on after the song playing
export const reshuffle = (
  context: PlayContext,
  playlist: Playlist,
  shuffled: boolean,
  random: Random
): PlayContext => {
  if (shuffled) {
    const played = context.order.slice(0, context.at + 1)
    const done = new Set(played.map((song) => song.videoId))
    const rest = playlist.songs.filter((song) => !done.has(song.videoId))
    return {
      ...context,
      order: [...played, ...spreadShuffle(rest, artistOf, random)],
      shuffled,
    }
  }
  const current = context.order[context.at]
  return {
    ...context,
    at: playlist.songs.findIndex((song) => song.videoId === current?.videoId),
    order: playlist.songs,
    shuffled,
  }
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
