import { expect, test } from 'bun:test'

import {
  GUEST_LISTENS_PER_HOUR,
  GUEST_WINDOW_MS,
  REPEAT_LISTEN_MS,
  addListen,
  likerOf,
  listListenCounts,
  listListensOf,
  listRecentListens,
  listenerOf,
  pruneListens,
  readStats,
  setLike,
} from './songs'
import { migratedD1 } from './test-d1'

const SONG = '6rG_irmOQsM'
const DEVICE = '0f8b3c3e-6a1e-4c62-9d2a-5b7d1f0c9e11'
const guest = (n: number) =>
  `d:0f8b3c3e-6a1e-4c62-9d2a-${n.toString(16).padStart(12, '0')}`
const account = (n: number) => `u:${n}`

// Listens of one song by `count` listeners, one after another (each is a transaction of its own)
const listensBy = async (
  db: D1Database,
  videoId: string,
  count: number,
  listener: (n: number) => string,
  at: number
) => {
  for (let n = 0; n < count; n += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- in order, as D1 runs them
    await addListen(db, videoId, listener(n), at)
  }
}

test("an account's every visit counts, but a reload within a minute is the same visit", async () => {
  const { db } = migratedD1()
  const before = await readStats(db, SONG, null)
  await addListen(db, SONG, 'u:me', 1)
  // A reload, and the page mounted twice
  await addListen(db, SONG, 'u:me', 2)
  await addListen(db, SONG, 'u:me', REPEAT_LISTEN_MS)
  const sameVisit = await readStats(db, SONG, null)
  // Back to the song five minutes later, and again five after that
  await addListen(db, SONG, 'u:me', 5 * 60_000)
  await addListen(db, SONG, 'u:me', 10 * 60_000)
  // Another listener, and another song, count on their own
  await addListen(db, SONG, guest(1), 3)
  await addListen(db, 'aaaaaaaaaaa', 'u:me', 3)
  const after = await readStats(db, SONG, null)
  expect([before.listens, sameVisit.listens, after.listens]).toEqual([0, 1, 4])
})

test("a guest's device counts one listen per song an hour", async () => {
  const { db } = migratedD1()
  await addListen(db, SONG, guest(1), 1)
  await addListen(db, SONG, guest(1), 5 * 60_000)
  const withinHour = await readStats(db, SONG, null)
  await addListen(db, SONG, guest(1), GUEST_WINDOW_MS + 2)
  const later = await readStats(db, SONG, null)
  expect([withinHour.listens, later.listens]).toEqual([1, 2])
})

test("past the song's hourly guest limit a new device's listen doesn't count; an account's still does", async () => {
  const { db } = migratedD1()
  await listensBy(db, SONG, GUEST_LISTENS_PER_HOUR + 5, guest, 10)
  await addListen(db, SONG, 'u:me', 10)
  const capped = await readStats(db, SONG, null)
  // An hour on, guests count again
  await addListen(db, SONG, guest(999), 10 + GUEST_WINDOW_MS + 1)
  const later = await readStats(db, SONG, null)
  expect([capped.listens, later.listens]).toEqual([
    GUEST_LISTENS_PER_HOUR + 1,
    GUEST_LISTENS_PER_HOUR + 2,
  ])
})

test('the daily prune keeps only listens inside the hour', async () => {
  const { db, sqlite } = migratedD1()
  await addListen(db, SONG, guest(1), 1)
  await addListen(db, SONG, guest(2), GUEST_WINDOW_MS)
  await pruneListens(db, GUEST_WINDOW_MS + 1)
  expect(sqlite.query('select "listener" from "songListen"').all()).toEqual([
    { listener: guest(2) },
  ])
})

test('recent listens: latest first, and a song played again moves to the front', async () => {
  const { db } = migratedD1()
  await addListen(db, 'aaaaaaaaaaa', 'u:a', 1)
  await addListen(db, 'bbbbbbbbbbb', 'u:a', 2)
  await addListen(db, 'ccccccccccc', 'u:a', 3)
  await addListen(db, 'aaaaaaaaaaa', 'u:b', 4)
  expect(await listRecentListens(db)).toEqual([
    'aaaaaaaaaaa',
    'ccccccccccc',
    'bbbbbbbbbbb',
  ])
})

test('one like per account: liking twice counts once, unliking takes it back; old device likes count nothing', async () => {
  const { db, sqlite } = migratedD1()
  sqlite.run(
    `insert into "songLike" ("videoId", "liker", "createdAt") values ('${SONG}', 'd:${DEVICE}', 0)`
  )
  const liker = likerOf('user-1')
  await setLike(db, SONG, liker, true, 1)
  await setLike(db, SONG, liker, true, 2)
  expect(await readStats(db, SONG, liker)).toEqual({
    liked: true,
    likes: 1,
    listens: 0,
  })
  await setLike(db, SONG, liker, false, 3)
  expect(await readStats(db, SONG, liker)).toEqual({
    liked: false,
    likes: 0,
    listens: 0,
  })
})

test('a listen needs an account or a well-formed device id', () => {
  expect(listenerOf('user-1', DEVICE)).toBe('u:user-1')
  expect(listenerOf(null, DEVICE)).toBe(`d:${DEVICE}`)
  expect(listenerOf(null, null)).toBeNull()
  expect(listenerOf(null, 'not-a-uuid')).toBeNull()
})

test('card counts: only songs played more than ten times', async () => {
  const { db } = migratedD1()
  await listensBy(db, 'aaaaaaaaaaa', 11, account, 1)
  await listensBy(db, 'bbbbbbbbbbb', 10, account, 1)
  await listensBy(db, 'ccccccccccc', 1, account, 1)
  expect(await listListenCounts(db)).toEqual({ aaaaaaaaaaa: 11 })
})

test("a list's own songs: exact counts, any played at least once, nothing for the rest", async () => {
  const { db } = migratedD1()
  await listensBy(db, 'aaaaaaaaaaa', 11, account, 1)
  await listensBy(db, 'ccccccccccc', 1, account, 1)
  expect(
    await listListensOf(db, ['ccccccccccc', 'ddddddddddd', 'aaaaaaaaaaa'])
  ).toEqual({ aaaaaaaaaaa: 11, ccccccccccc: 1 })
  expect(await listListensOf(db, [])).toEqual({})
})

test("an account's plays are its counted listens, never a guest's", async () => {
  const { db } = migratedD1()
  const plays = async () =>
    await db
      .prepare(
        `select "plays", "lastPlayAt" from "accountStats" where "userId" = ?1`
      )
      .bind('me')
      .first<{ plays: number; lastPlayAt: number }>()
  await addListen(db, SONG, 'u:me', 1)
  await addListen(db, SONG, 'u:me', 2)
  await addListen(db, 'aaaaaaaaaaa', 'u:me', 3)
  const sameVisit = await plays()
  await addListen(db, SONG, 'u:me', 5 * 60_000)
  await addListen(db, SONG, `d:${DEVICE}`, 5 * 60_000 + 1)
  const later = await plays()
  const guestRows = await db
    .prepare(
      `select count(*) as "n" from "accountStats" where "userId" <> 'me'`
    )
    .first<{ n: number }>()
  expect([sameVisit, later, guestRows?.n]).toEqual([
    { lastPlayAt: 3, plays: 2 },
    { lastPlayAt: 5 * 60_000, plays: 3 },
    0,
  ])
})
