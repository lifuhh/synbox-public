import { Database } from 'bun:sqlite'
import type { SQLQueryBindings } from 'bun:sqlite'
import { beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { finishGeneration, getQuota, reserveGeneration } from './quota'

// The subset of D1 that quota.ts uses, over bun:sqlite with the real migrations
const asD1 = (sqlite: Database) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the parts of D1 quota.ts calls
  ({
    prepare(sql: string) {
      let params: SQLQueryBindings[] = []
      const statement = {
        bind(...values: SQLQueryBindings[]) {
          params = values
          return statement
        },
        // oxlint-disable-next-line eslint/require-await -- D1's methods are async; bun:sqlite's are not
        async first(column?: string) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:sqlite returns rows untyped
          const row = sqlite.query(sql).get(...params) as Record<
            string,
            unknown
          > | null
          return row !== null && column !== undefined ? row[column] : row
        },
        // oxlint-disable-next-line eslint/require-await -- as above
        async run() {
          const { changes } = sqlite.query(sql).run(...params)
          return { meta: { changes } }
        },
      }
      return statement
    },
  }) as unknown as D1Database

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

beforeEach(() => {
  sqlite = new Database(':memory:')
  for (const file of [
    '0001_auth.sql',
    '0002_generation.sql',
    '0003_guest_generations.sql',
  ]) {
    sqlite.run(
      readFileSync(`${import.meta.dir}/../migrations/${file}`, 'utf-8')
    )
  }
  const user = sqlite.prepare(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned") values (?, 'n', ?, 1, 0, 0, ?, ?)`
  )
  user.run('u1', 'a@x', 'user', 0)
  user.run('admin', 'b@x', 'admin', 0)
  user.run('banned', 'c@x', 'user', 1)
  db = asD1(sqlite)
})

test('the daily limit holds and a reconnect is free', async () => {
  expect(await reserve('r1')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r1')).toEqual({ outcome: 'replay' })
  expect(await reserve('r2')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r3')).toEqual({
    limit: 2,
    outcome: 'quota_exceeded',
    resetsAt: '2026-10-22T00:00:00.000Z',
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
