import { beforeEach, expect, test } from 'bun:test'

import type { LibraryOp, LibrarySong } from './library'
import {
  BOOKMARKS_LIMIT,
  HISTORY_LIMIT,
  PLAYLISTS_LIMIT,
  PLAYLISTS_SIZE_LIMIT,
  applyOps,
  parseOps,
  readLibrary,
} from './library'
import { migratedD1 } from './test-d1'

let db: D1Database

const song = (videoId: string, title = videoId): LibrarySong => ({
  author: 'a',
  thumbnailUrl: 't',
  title,
  videoId,
})
const playlist = (id: string, updatedAt: number, songs: LibrarySong[]) => ({
  createdAt: 1,
  id,
  name: 'List',
  songs,
  updatedAt,
})
const apply = async (...ops: LibraryOp[]) => {
  await applyOps(db, 'u1', ops)
  return await readLibrary(db, 'u1')
}

beforeEach(() => {
  const { db: fresh, sqlite } = migratedD1()
  db = fresh
  sqlite
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (?, 'n', ?, 1, 0, 0)`
    )
    .run('u1', 'a@x')
})

test('a replayed or late play neither duplicates a song nor moves it back', async () => {
  const first = { at: 10, kind: 'play', song: song('a') } as const
  await apply(first, { at: 20, kind: 'play', song: song('b') })
  const library = await apply(
    { at: 30, kind: 'play', song: song('a', 'new title') },
    first
  )
  expect(library.history.map((h) => [h.videoId, h.playedAt, h.title])).toEqual([
    ['a', 30, 'new title'],
    ['b', 20, 'b'],
  ])
})

test('plays from before Clear History stay cleared when they arrive late', async () => {
  await apply({ at: 10, kind: 'play', song: song('a') })
  const library = await apply(
    { at: 20, kind: 'clearHistory' },
    { at: 15, kind: 'play', song: song('b') },
    { at: 25, kind: 'play', song: song('c') }
  )
  expect(library.history.map((h) => h.videoId)).toEqual(['c'])
})

test('history keeps the newest songs up to the limit', async () => {
  const plays = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => ({
    at: i + 1,
    kind: 'play' as const,
    song: song(`v${i}`),
  }))
  const { history } = await apply(...plays)
  expect(history).toHaveLength(HISTORY_LIMIT)
  expect(history.at(-1)?.videoId).toBe('v5')
})

test('a removed bookmark stays removed when an older save arrives after it', async () => {
  await apply({ at: 10, kind: 'bookmark', saved: true, song: song('a') })
  await apply({ at: 30, kind: 'bookmark', saved: false, song: song('a') })
  const library = await apply(
    { at: 20, kind: 'bookmark', saved: true, song: song('a') },
    { at: 40, kind: 'bookmark', saved: true, song: song('b') }
  )
  expect(library.bookmarks.map((b) => b.videoId)).toEqual(['b'])
})

test('a deleted playlist ignores older edits and comes back for a newer one', async () => {
  await apply({ kind: 'playlist', playlist: playlist('p', 10, [song('a')]) })
  await apply({ at: 20, id: 'p', kind: 'deletePlaylist' })
  const stale = await apply({
    kind: 'playlist',
    playlist: playlist('p', 15, []),
  })
  expect(stale.playlists).toEqual([])
  const { playlists } = await apply({
    kind: 'playlist',
    playlist: playlist('p', 30, [song('b'), song('a')]),
  })
  expect(playlists).toEqual([playlist('p', 30, [song('b'), song('a')])])
})

test('one malformed op refuses the batch, and a time ahead of the server is cut to now', () => {
  expect(
    parseOps(
      {
        ops: [
          { at: 1, kind: 'clearHistory' },
          { at: 1, kind: 'play' },
        ],
      },
      100
    )
  ).toBeNull()
  expect(parseOps({ ops: [{ at: 500, kind: 'clearHistory' }] }, 100)).toEqual([
    { at: 100, kind: 'clearHistory' },
  ])
})

const bookmark = (videoId: string, at = 5) =>
  ({ at, kind: 'bookmark', saved: true, song: song(videoId) }) as const

test('past the bookmark limit a batch writes nothing, its plays included; re-saving a kept bookmark still works', async () => {
  const fill = Array.from({ length: BOOKMARKS_LIMIT - 1 }, (_, n) =>
    bookmark(`b${n}`)
  )
  expect(await applyOps(db, 'u1', fill)).toBe(true)
  const over = [
    bookmark('new1'),
    bookmark('new2'),
    { at: 9, kind: 'play', song: song('p') } as const,
  ]
  expect(await applyOps(db, 'u1', over)).toBe(false)
  const library = await readLibrary(db, 'u1')
  expect([library.bookmarks.length, library.history.length]).toEqual([
    BOOKMARKS_LIMIT - 1,
    0,
  ])
  expect(await applyOps(db, 'u1', [bookmark('new1'), bookmark('b0', 6)])).toBe(
    true
  )
})

// A song of about 1,000 characters (near the longest fields allowed)
const long = (n: number) => ({
  author: 'a'.repeat(300),
  thumbnailUrl: 't'.repeat(400),
  title: 'x'.repeat(300),
  videoId: `v${n}`,
})

// 100 long songs: about 100,000 characters
const big = (id: string, at = 10) =>
  ({
    kind: 'playlist',
    playlist: playlist(
      id,
      at,
      Array.from({ length: 100 }, (_, n) => long(n))
    ),
  }) as const

test('playlists stay under their count and size limits; deleting one frees its songs', async () => {
  const fits = Math.floor(
    PLAYLISTS_SIZE_LIMIT / JSON.stringify(big('p').playlist.songs).length
  )
  for (let n = 0; n < fits; n += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one sync after another
    expect(await applyOps(db, 'u1', [big(`p${n}`)])).toBe(true)
  }
  expect(await applyOps(db, 'u1', [big('over')])).toBe(false)
  expect(
    await applyOps(db, 'u1', [{ at: 20, id: 'p0', kind: 'deletePlaylist' }])
  ).toBe(true)
  expect(await applyOps(db, 'u1', [big('over')])).toBe(true)
  // Empty playlists (and deleted ones) count toward the number kept
  const empties = Array.from({ length: PLAYLISTS_LIMIT }, (_, n) => ({
    at: 30,
    id: `gone${n}`,
    kind: 'deletePlaylist' as const,
  }))
  expect(await applyOps(db, 'u1', empties)).toBe(false)
})
