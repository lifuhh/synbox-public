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
  // Where in `order` the playlist is: the song of it playing now, or the last one played before a queued song.
  // It goes on from the next song after this one that it hasn't played
  at: number
  // The playlist's songs played while it plays, wherever they were played from (the queue too), so none plays
  // twice
  played: string[]
  // The song the playlist last followed (followSong): opening it again (the resume bar, a reload) changes nothing
  current: string
}

const placeOf = (context: PlayContext, videoId: string) =>
  context.order.findIndex((song) => song.videoId === videoId)

// The playlist's song to play after `current`: the first after its place that it hasn't played; -1 when it has
// none left
export const contextNext = (context: PlayContext, current: string) =>
  context.order.findIndex(
    (song, index) =>
      index > context.at &&
      song.videoId !== current &&
      !context.played.includes(song.videoId)
  )

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
    const at = contextNext(context, current)
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

// Previous: the song played before `current`, taken off the trail; null when nothing was played before it.
// Between two of the playlist's songs it steps the playlist back by place: the playlist goes on from the song it
// went back to, and `current` can play again. Otherwise `current` goes first in the queue, so Next comes back to
// it
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
  const from = context === null ? -1 : placeOf(context, current.videoId)
  const to = context === null ? -1 : placeOf(context, song.videoId)
  return context !== null && from !== -1 && to !== -1
    ? {
        context: {
          ...context,
          at: to,
          played: context.played.filter((id) => id !== current.videoId),
        },
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

// The playlist after a song opens. One it followed last stays as it is. One opened from the queue or by
// Previous (`kept`) leaves its place alone; if it is one of its songs it counts as played. Any other of its
// songs (Next, a row in its panel) becomes its place. Any other song the listener picked ends it
export const followSong = (
  context: PlayContext | null,
  videoId: string,
  kept: boolean
): PlayContext | null => {
  if (context === null || videoId === context.current) {
    return context
  }
  const at = placeOf(context, videoId)
  if (at === -1) {
    return kept ? { ...context, current: videoId } : null
  }
  return {
    ...context,
    at: kept ? context.at : at,
    current: videoId,
    played: context.played.includes(videoId)
      ? context.played
      : [...context.played, videoId],
  }
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
  const begin = (order: ListSong[], at: number) => {
    const song = order[at]
    return {
      ...base,
      at,
      current: song.videoId,
      order,
      played: [song.videoId],
      shuffled,
    }
  }
  if (!shuffled) {
    return begin(playlist.songs, from ?? 0)
  }
  const start = from === undefined ? undefined : playlist.songs[from]
  const rest = spreadShuffle(
    start === undefined
      ? playlist.songs
      : without(playlist.songs, start.videoId),
    artistOf,
    random
  )
  return begin(start === undefined ? rest : [start, ...rest], 0)
}

// Shuffle turned on or off while a playlist plays. On: the songs played lead, and a new shuffle of every song not
// yet played follows, those listed before the one it started from too. Off: the playlist's own order, going on
// after its song played last
export const reshuffle = (
  context: PlayContext,
  songs: ListSong[],
  shuffled: boolean,
  random: Random
): PlayContext => {
  const done = new Set(context.played)
  if (shuffled) {
    const played = context.order.filter((song) => done.has(song.videoId))
    const rest = songs.filter((song) => !done.has(song.videoId))
    return {
      ...context,
      at: played.length - 1,
      order: [...played, ...spreadShuffle(rest, artistOf, random)],
      shuffled,
    }
  }
  const last = context.order[context.at]?.videoId
  return {
    ...context,
    at: songs.findIndex((song) => song.videoId === last),
    order: songs,
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
