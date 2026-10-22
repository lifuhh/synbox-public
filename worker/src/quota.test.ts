import type { Database } from 'bun:sqlite'
import { beforeEach, expect, test } from 'bun:test'

import type { Owner } from './quota'
import {
  checkGeneration,
  finishGeneration,
  getQuota,
  reserveGeneration,
} from './quota'
import { migratedD1 } from './test-d1'

let db: D1Database
let sqlite: Database
const now = new Date('2026-10-21T10:00:00Z')
const LIMITS = { guest: 1, guestTotal: 2, user: 2 }
const reserve = async (id: string, userId = 'u1', videoId = 'v') =>
  await reserveGeneration(
    db,
    { id, kind: 'new', owner: { id: userId, kind: 'user' }, videoId },
    LIMITS,
    now
  )
const reserveAsGuest = async (id: string, key: string) =>
  await reserveGeneration(
    db,
    { id, kind: 'new', owner: { key, kind: 'guest' }, videoId: 'v' },
    LIMITS,
    now
  )

const check = async (owner: Owner) =>
  await checkGeneration(db, { kind: 'new', owner, videoId: 'v' }, LIMITS, now)

beforeEach(() => {
  ;({ db, sqlite } = migratedD1())
  const user = sqlite.prepare(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned") values (?, 'n', ?, 1, 0, 0, ?, ?)`
  )
  user.run('u1', 'a@x', 'user', 0)
  user.run('admin', 'b@x', 'admin', 0)
  user.run('banned', 'c@x', 'user', 1)
})

test('the daily limit holds and a reconnect is free', async () => {
  expect(await reserve('r1')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r1')).toEqual({ outcome: 'replay' })
  expect(await reserve('r2')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r3')).toEqual({
    limit: 2,
    outcome: 'quota_exceeded',
    resetsAt: '2026-10-21T11:00:00.000Z',
  })
  expect(await getQuota(db, 'u1', LIMITS, now)).toMatchObject({
    limit: 2,
    used: 2,
  })
})

test('a failed song gives its slot back, and trying it again takes a slot again', async () => {
  await reserve('r1')
  await reserve('r2')
  await finishGeneration(db, 'r2', { errorCode: 'x', status: 'failed' }, now)
  expect(await reserve('r3')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r2')).toMatchObject({ outcome: 'quota_exceeded' })
  await finishGeneration(db, 'r3', { errorCode: 'x', status: 'failed' }, now)
  expect(await reserve('r2')).toEqual({ outcome: 'reserved' })
})

test('a request id never opens another video, another user, or a second run once it worked', async () => {
  await reserve('r1')
  expect(await reserve('r1', 'u1', 'other')).toEqual({ outcome: 'forbidden' })
  expect(await reserve('r1', 'admin')).toEqual({ outcome: 'forbidden' })
  await finishGeneration(
    db,
    'r1',
    { resultVersion: 3, status: 'succeeded' },
    now
  )
  expect(await reserve('r1')).toEqual({ outcome: 'already_finished' })
  expect(await finishGeneration(db, 'r1', { status: 'failed' }, now)).toBe(
    false
  )
})

test('an admin has no limit and a banned user is refused', async () => {
  expect(await reserve('a1', 'admin')).toEqual({ outcome: 'reserved' })
  expect(await reserve('a2', 'admin')).toEqual({ outcome: 'reserved' })
  expect(await reserve('a3', 'admin')).toEqual({ outcome: 'reserved' })
  expect(await reserve('b1', 'banned')).toEqual({ outcome: 'forbidden' })
})

test('an override replaces the default limit, and pausing stops everyone', async () => {
  sqlite.run(`insert into "quotaOverride" values ('u1', 0, null, 'admin', 0)`)
  expect(await reserve('r1')).toMatchObject({
    limit: 0,
    outcome: 'quota_exceeded',
  })
  sqlite.run(
    `update "appSetting" set "value" = '0' where "key" = 'generationEnabled'`
  )
  expect(await reserve('a1', 'admin')).toEqual({ outcome: 'generation_paused' })
})

test('an unlimited override lifts the limit, and removing it brings the default back', async () => {
  sqlite.run(
    `insert into "quotaOverride" values ('u1', null, null, 'admin', 0)`
  )
  expect(await reserve('r1')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r2')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r3')).toEqual({ outcome: 'reserved' })
  expect(await getQuota(db, 'u1', LIMITS, now)).toMatchObject({
    limit: null,
    used: 3,
  })
  sqlite.run(`delete from "quotaOverride" where "userId" = 'u1'`)
  expect(await reserve('r4')).toMatchObject({
    limit: 2,
    outcome: 'quota_exceeded',
  })
})

test('a guest gets one song a day, and all guests together stop at the shared cap', async () => {
  expect(await reserveAsGuest('g1', 'net-a')).toEqual({ outcome: 'reserved' })
  expect(await reserveAsGuest('g2', 'net-a')).toEqual({
    outcome: 'guest_limit',
  })
  expect(await reserveAsGuest('g3', 'net-b')).toEqual({ outcome: 'reserved' })
  expect(await reserveAsGuest('g4', 'net-c')).toEqual({
    outcome: 'guests_full',
  })
  // Signed-in users don't share the guests' cap
  expect(await reserve('r1')).toEqual({ outcome: 'reserved' })
  // A guest's request id is not a user's, and the other way round
  expect(await reserve('g1')).toEqual({ outcome: 'forbidden' })
})

test("a user's limit is per rolling hour", async () => {
  await reserve('r1')
  await reserve('r2')
  expect(await reserve('r3')).toMatchObject({ outcome: 'quota_exceeded' })
  const later = new Date(now.getTime() + 3_600_001)
  expect(
    await reserveGeneration(
      db,
      {
        id: 'r3',
        kind: 'new',
        owner: { id: 'u1', kind: 'user' },
        videoId: 'v',
      },
      LIMITS,
      later
    )
  ).toEqual({ outcome: 'reserved' })
})

test('a check answers what reserving would, and takes nothing', async () => {
  const user: Owner = { id: 'u1', kind: 'user' }
  const guest: Owner = { key: 'g1', kind: 'guest' }
  expect(await check(user)).toEqual({ outcome: 'allowed' })
  expect(await check(user)).toEqual({ outcome: 'allowed' })
  await reserve('r1')
  await reserve('r2')
  expect(await check(user)).toMatchObject({ outcome: 'quota_exceeded' })
  expect(await check({ id: 'admin', kind: 'user' })).toEqual({
    outcome: 'allowed',
  })
  expect(await check({ id: 'banned', kind: 'user' })).toEqual({
    outcome: 'forbidden',
  })
  expect(await check(guest)).toEqual({ outcome: 'allowed' })
  await reserveAsGuest('g', 'g1')
  expect(await check(guest)).toEqual({ outcome: 'guest_limit' })
  sqlite.run(
    `update "appSetting" set "value" = '0' where "key" = 'generationEnabled'`
  )
  expect(await check({ id: 'admin', kind: 'user' })).toEqual({
    outcome: 'generation_paused',
  })
})

const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

test('a generation nobody reports on for 15 minutes stops counting; one that reports keeps its slot', async () => {
  expect(await reserve('r1')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r2')).toEqual({ outcome: 'reserved' })
  // r1 keeps reporting; r2 went quiet when the app was put away
  expect(
    await finishGeneration(
      db,
      'r1',
      { fraction: 0.4, stage: 'Separating the vocals', status: 'running' },
      later(10)
    )
  ).toBe(true)
  const at = later(20)
  expect(
    await reserveGeneration(
      db,
      {
        id: 'r3',
        kind: 'new',
        owner: { id: 'u1', kind: 'user' },
        videoId: 'v',
      },
      LIMITS,
      at
    )
  ).toEqual({ outcome: 'reserved' })
  const rows = sqlite
    .query(
      `select "id", "status", "errorCode", "stage", "fraction" from "generation" order by "id"`
    )
    .all()
  expect(rows).toEqual([
    {
      errorCode: null,
      fraction: 0.4,
      id: 'r1',
      stage: 'Separating the vocals',
      status: 'running',
    },
    {
      errorCode: 'abandoned',
      fraction: null,
      id: 'r2',
      stage: null,
      status: 'failed',
    },
    {
      errorCode: null,
      fraction: null,
      id: 'r3',
      stage: null,
      status: 'reserved',
    },
  ])
})
