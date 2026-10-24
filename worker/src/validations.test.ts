import type { Database } from 'bun:sqlite'
import { beforeEach, expect, test } from 'bun:test'

import type { Owner } from './quota'
import { migratedD1 } from './test-d1'
import { countValidation, pruneValidations } from './validations'

let db: D1Database
let sqlite: Database
const now = new Date('2026-10-25T10:00:00Z')
const HOUR = 3_600_000
const LIMITS = { guest: 1, guestTotal: 20, network: 30, user: 10 }
const CAPS = { guest: 2, network: 3, user: 2 }

const user = (id: string): Owner => ({ id, kind: 'user' })
const guest = (key: string): Owner => ({ key, kind: 'guest' })

const validate = async (
  id: string,
  owner: Owner,
  { network = 'net-a', at = now, videoId = 'abcdefghijk' } = {}
) => {
  const counted = await countValidation(
    db,
    { client: 'test', id, network, owner, videoId },
    LIMITS,
    CAPS,
    at
  )
  return counted.outcome
}

const rows = (sql: string) => sqlite.query(sql).all()

beforeEach(() => {
  ;({ db, sqlite } = migratedD1())
  const insert = sqlite.prepare(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned") values (?, 'n', ?, 1, 0, 0, ?, ?)`
  )
  insert.run('u1', 'a@x', 'user', 0)
  insert.run('u2', 'b@x', 'user', 0)
  insert.run('admin', 'c@x', 'admin', 0)
  insert.run('banned', 'd@x', 'user', 1)
  insert.run('vip', 'e@x', 'user', 0)
  sqlite.run(
    `insert into "quotaOverride" ("userId", "dailyLimit", "setBy", "setAt") values ('vip', null, 'admin', 0)`
  )
})

test("an owner's checks stop at its cap, and asking again with the same id counts once", async () => {
  expect(await validate('c1', user('u1'), { network: 'n1' })).toBe('counted')
  expect(await validate('c1', user('u1'), { network: 'n1' })).toBe('replay')
  expect(await validate('c2', user('u1'), { network: 'n1' })).toBe('counted')
  expect(await validate('c3', user('u1'), { network: 'n1' })).toBe(
    'validation_limit'
  )
  expect(await validate('c2', user('u1'), { network: 'n1' })).toBe('replay')
  expect(rows(`select "code" from "refusal"`)).toEqual([
    { code: 'validation_limit' },
  ])
  expect(await validate('g1', guest('n2'), { network: 'n2' })).toBe('counted')
  expect(await validate('g2', guest('n2'), { network: 'n2' })).toBe('counted')
  expect(await validate('g3', guest('n2'), { network: 'n2' })).toBe(
    'validation_limit'
  )
})

test('guests and default accounts on one network share its cap; admins and overrides are not held to it', async () => {
  expect(await validate('a', guest('net-a'))).toBe('counted')
  expect(await validate('b', user('u1'))).toBe('counted')
  expect(await validate('c', user('u2'))).toBe('counted')
  expect(await validate('d', user('u2'))).toBe('validation_limit')
  const exempt = [
    ...['e', 'f', 'g', 'h'].map((id) => ({ id, owner: user('admin') })),
    ...['e2', 'f2', 'g2', 'h2'].map((id) => ({ id, owner: user('vip') })),
  ]
  for (const { id, owner } of exempt) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each check must see the ones before it
    expect(await validate(id, owner)).toBe('counted')
  }
  expect(await validate('i', user('u2'), { network: 'net-b' })).toBe('counted')
})

test('an id is one check for one owner and video, and a banned account gets none', async () => {
  await validate('c1', user('u1'))
  expect(await validate('c1', user('u2'))).toBe('forbidden')
  expect(await validate('c1', user('u1'), { videoId: 'bbbbbbbbbbb' })).toBe(
    'forbidden'
  )
  expect(await validate('c2', user('banned'))).toBe('forbidden')
})

test('checks older than 24 hours count for nothing, and the daily prune removes them', async () => {
  const yesterday = new Date(now.getTime() - 25 * HOUR)
  await validate('old1', user('u1'), { at: yesterday })
  await validate('old2', user('u1'), { at: yesterday })
  expect(await validate('new1', user('u1'))).toBe('counted')
  await pruneValidations(db, now.getTime())
  expect(rows(`select "id" from "validation"`)).toEqual([{ id: 'new1' }])
})
