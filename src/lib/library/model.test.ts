import { expect, test } from 'vite-plus/test'

import type { Library } from './model'
import { applyOp, emptyLibrary, libraryOps } from './model'

const song = (videoId: string) => ({
  author: 'a',
  thumbnailUrl: 't',
  title: videoId,
  videoId,
})

test('a change still queued survives the account copy it is applied over', () => {
  const account: Library = {
    ...emptyLibrary,
    bookmarks: [song('a')],
    history: [{ ...song('x'), timestamp: 20 }],
  }
  let library = applyOp(account, { at: 30, kind: 'play', song: song('y') })
  library = applyOp(library, { at: 10, kind: 'play', song: song('x') })
  library = applyOp(library, {
    at: 31,
    kind: 'bookmark',
    saved: false,
    song: song('a'),
  })
  expect(library.history.map((item) => [item.videoId, item.timestamp])).toEqual(
    [
      ['y', 30],
      ['x', 20],
    ]
  )
  expect(library.bookmarks).toEqual([])
})

test("a guest's library replayed as ops rebuilds the same library", () => {
  const guest: Library = {
    bookmarks: [song('b1'), song('b2')],
    history: [
      { ...song('h2'), timestamp: 2 },
      { ...song('h1'), timestamp: 1 },
    ],
    playlists: [
      { createdAt: 5, id: 'p2', name: 'Two', songs: [], updatedAt: 5 },
      {
        createdAt: 3,
        id: 'p1',
        name: 'One',
        songs: [song('h1')],
        updatedAt: 4,
      },
    ],
  }
  let rebuilt = emptyLibrary
  for (const op of libraryOps(guest, 100)) {
    rebuilt = applyOp(rebuilt, op)
  }
  expect(rebuilt).toEqual(guest)
})
