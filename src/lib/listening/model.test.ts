import { describe, expect, it } from 'vite-plus/test'

import {
  addToPlaylist,
  addToQueue,
  move,
  newPlaylist,
  leftSong,
  nextSong,
  followSong,
  playNext,
  playPlaylist,
  previousSong,
  reshuffle,
} from './model'
import type { ListeningState } from './model'
import { cryptoRandom } from './shuffle'

const song = (videoId: string) => ({
  author: 'a',
  thumbnailUrl: '',
  title: videoId,
  videoId,
})

const ids = (songs: { videoId: string }[]) => songs.map((s) => s.videoId)

describe('queue', () => {
  it('adds a song once', () => {
    const queue = addToQueue([song('a')], song('b'))
    expect(ids(addToQueue(queue, song('a')))).toEqual(['a', 'b'])
  })

  it('moves an already queued song to the front on Play Next', () => {
    expect(ids(playNext([song('a'), song('b')], song('b')))).toEqual(['b', 'a'])
  })

  it('reorders by index and ignores out-of-range moves', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(move(items, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(move(items, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(move(items, 1, 9)).toBe(items)
  })
})

describe('nextSong', () => {
  const recs = [song('now'), song('r1'), song('r2')]

  it('plays the queue first, skipping the song that just played', () => {
    const next = nextSong(
      {
        autoplay: true,
        context: null,
        queue: [song('now'), song('q1'), song('q2')],
      },
      'now',
      recs,
      []
    )
    expect(next?.song.videoId).toBe('q1')
    expect(ids(next?.queue ?? [])).toEqual(['q2'])
  })

  it('falls back to a recommendation not played recently', () => {
    const next = nextSong(
      { autoplay: true, context: null, queue: [] },
      'now',
      recs,
      ['r1']
    )
    expect(next?.song.videoId).toBe('r2')
  })

  it('stops when autoplay is off and the queue is empty', () => {
    expect(
      nextSong({ autoplay: false, context: null, queue: [] }, 'now', recs, [])
    ).toBeNull()
  })
  it('goes on to a recommendation on a press even with autoplay off', () => {
    const next = nextSong(
      { autoplay: false, context: null, queue: [] },
      'now',
      recs,
      [],
      true
    )
    expect(next?.song.videoId).toBe('r1')
  })
})

describe('previousSong', () => {
  it('walks back the trail, and Next then returns to where Previous left', () => {
    const played = leftSong(leftSong([], song('a')), song('b'))
    const back = previousSong(
      played,
      { context: null, queue: [song('q')] },
      song('c')
    )
    expect(back?.song.videoId).toBe('b')
    expect(ids(back?.queue ?? [])).toEqual(['c', 'q'])
    const again = previousSong(
      back?.played ?? [],
      { context: null, queue: back?.queue ?? [] },
      song('b')
    )
    expect(again?.song.videoId).toBe('a')
    const forward = nextSong(
      { autoplay: false, context: null, queue: again?.queue ?? [] },
      'a',
      [],
      [],
      true
    )
    expect(forward?.song.videoId).toBe('b')
  })

  it('has nothing to go back to at the start of a visit', () => {
    const empty = { context: null, queue: [] }
    expect(previousSong([], empty, song('a'))).toBeNull()
    expect(previousSong([song('a')], empty, song('a'))).toBeNull()
  })
})

describe('playlists', () => {
  it('names an unnamed playlist and keeps each song once', () => {
    const list = newPlaylist('  ', [], 1, 'p')
    expect(list.name).toBe('New Playlist')
    const once = addToPlaylist(list, song('a'), 2)
    expect(addToPlaylist(once, song('a'), 3)).toBe(once)
    expect(once.updatedAt).toBe(2)
  })
})

const playing = (context: ReturnType<typeof playPlaylist>, queue = []) => ({
  autoplay: true,
  context,
  queue,
})

// The songs played from `current` on, pressing Next each time and following each song as the player does: a song
// from the queue leaves the playlist waiting
const playAll = (
  state: ListeningState,
  current: string,
  songs: string[] = []
): string[] => {
  const next = nextSong(state, current, [], [], true)
  if (next === null || songs.length >= 20) {
    return songs
  }
  const queued = next.context === state.context
  return playAll(
    {
      autoplay: state.autoplay,
      context: followSong(next.context, next.song.videoId, queued),
      queue: next.queue,
    },
    next.song.videoId,
    [...songs, next.song.videoId]
  )
}

describe('playing a playlist', () => {
  const list = newPlaylist(
    'Mix',
    ['a', 'b', 'c', 'd'].map((id) => song(id)),
    1,
    'p'
  )

  it('plays songs added to the queue before the rest of the playlist, then goes on where it was', () => {
    const context = playPlaylist(
      list,
      { from: 1, shuffled: false },
      cryptoRandom
    )
    const queued = nextSong(
      { ...playing(context), queue: [song('x')] },
      'b',
      [song('r')],
      []
    )
    expect(queued?.song.videoId).toBe('x')
    const after = nextSong(
      { autoplay: true, context: queued?.context ?? null, queue: [] },
      'x',
      [song('r')],
      []
    )
    expect(after?.song.videoId).toBe('c')
  })

  it('goes on to recommendations once the playlist is over, and leaves it', () => {
    const context = playPlaylist(
      list,
      { from: 3, shuffled: false },
      cryptoRandom
    )
    const next = nextSong(playing(context), 'd', [song('r')], [])
    expect(next?.song.videoId).toBe('r')
    expect(next?.context).toBeNull()
  })

  it('steps back inside the playlist without playing a song twice', () => {
    const context = playPlaylist(
      list,
      { from: 2, shuffled: false },
      cryptoRandom
    )
    const back = previousSong(
      [song('a'), song('b')],
      playing(context),
      song('c')
    )
    expect(back?.song.videoId).toBe('b')
    expect(back?.queue).toEqual([])
    const there = followSong(back?.context ?? null, 'b', true)
    const next = nextSong(
      { autoplay: true, context: there, queue: back?.queue ?? [] },
      'b',
      [],
      []
    )
    expect(next?.song.videoId).toBe('c')
  })

  it('ends when the listener picks a song outside it, but waits through a queued one', () => {
    const context = playPlaylist(
      list,
      { from: 0, shuffled: false },
      cryptoRandom
    )
    expect(followSong(context, 'c', false)?.at).toBe(2)
    expect(followSong(context, 'x', true)).toEqual({ ...context, current: 'x' })
    expect(followSong(context, 'x', false)).toBeNull()
  })

  it('shuffles from the picked song, every song once', () => {
    const context = playPlaylist(
      list,
      { from: 2, shuffled: true },
      cryptoRandom
    )
    expect(context.order[0].videoId).toBe('c')
    expect(ids(context.order).toSorted()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('plays a queued song of the playlist once, without skipping the songs before it', () => {
    const context = playPlaylist(
      list,
      { from: 0, shuffled: false },
      cryptoRandom
    )
    expect(playAll({ ...playing(context), queue: [song('d')] }, 'a')).toEqual([
      'd',
      'b',
      'c',
    ])
  })

  it('shuffles every song not yet played, those before the one it started from too', () => {
    const context = playPlaylist(
      list,
      { from: 3, shuffled: false },
      cryptoRandom
    )
    const on = reshuffle(context, list.songs, true, cryptoRandom)
    expect(playAll(playing(on), 'd').toSorted()).toEqual(['a', 'b', 'c'])
  })

  it('goes on in the playlist order after its song when shuffle turns off', () => {
    const context = playPlaylist(
      list,
      { from: 1, shuffled: false },
      cryptoRandom
    )
    const on = reshuffle(context, list.songs, true, cryptoRandom)
    const off = reshuffle(on, list.songs, false, cryptoRandom)
    expect(playAll(playing(off), 'b')).toEqual(['c', 'd'])
  })

  it('steps back by place inside the playlist, and plays the song it left again', () => {
    const context = playPlaylist(
      list,
      { from: 0, shuffled: false },
      cryptoRandom
    )
    const atC = followSong(followSong(context, 'b', false), 'c', false)
    const back = previousSong(
      [song('a'), song('b')],
      { context: atC, queue: [] },
      song('c')
    )
    expect(back?.song.videoId).toBe('b')
    const there = followSong(back?.context ?? null, 'b', true)
    expect(
      playAll({ ...playing(there ?? context), queue: back?.queue ?? [] }, 'b')
    ).toEqual(['c', 'd'])
  })

  it('changes nothing when its own song opens again (the resume bar, a reload)', () => {
    const context = playPlaylist(
      list,
      { from: 0, shuffled: false },
      cryptoRandom
    )
    const queued = followSong(context, 'x', true)
    expect(followSong(queued, 'x', false)).toBe(queued)
  })
})
