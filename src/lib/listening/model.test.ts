import { describe, expect, it } from 'vite-plus/test'

import {
  addToPlaylist,
  addToQueue,
  move,
  newPlaylist,
  leftSong,
  nextSong,
  playFrom,
  playNext,
  previousSong,
} from './model'

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
        queue: [song('now'), song('q1'), song('q2')],
        source: null,
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
      { autoplay: true, queue: [], source: null },
      'now',
      recs,
      ['r1']
    )
    expect(next?.song.videoId).toBe('r2')
  })

  it('stops when autoplay is off and the queue is empty', () => {
    expect(
      nextSong({ autoplay: false, queue: [], source: null }, 'now', recs, [])
    ).toBeNull()
  })
  it('goes on to a recommendation on a press even with autoplay off', () => {
    const next = nextSong(
      { autoplay: false, queue: [], source: null },
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
    const back = previousSong(played, [song('q')], song('c'))
    expect(back?.song.videoId).toBe('b')
    expect(ids(back?.queue ?? [])).toEqual(['c', 'q'])
    const again = previousSong(back?.played ?? [], back?.queue ?? [], song('b'))
    expect(again?.song.videoId).toBe('a')
    const forward = nextSong(
      { autoplay: false, queue: again?.queue ?? [], source: null },
      'a',
      [],
      [],
      true
    )
    expect(forward?.song.videoId).toBe('b')
  })

  it('has nothing to go back to at the start of a visit', () => {
    expect(previousSong([], [], song('a'))).toBeNull()
    expect(previousSong([song('a')], [], song('a'))).toBeNull()
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

  it('plays from a song with the rest queued behind it', () => {
    const list = newPlaylist('Mix', [song('a'), song('b'), song('c')], 1, 'p')
    const play = playFrom(list, 1)
    expect(play.song.videoId).toBe('b')
    expect(ids(play.queue)).toEqual(['c'])
    expect(play.source).toEqual({ id: 'p', kind: 'playlist', name: 'Mix' })
  })
})
