import { expect, test } from 'bun:test'

import {
  INVITE_NOTE_MAX,
  decideInvite,
  parseInviteNote,
  readInviteStatus,
  requestInvite,
  setAdminNote,
} from './invites'
import { getQuota } from './quota'
import { migratedD1 } from './test-d1'

const LIMITS = { guest: 1, guestTotal: 20, network: 30, user: 1 }
const BY = { adminId: 'admin', dailyLimit: 5, now: 2 }

const limitOf = async (db: D1Database, userId: string) => {
  const quota = await getQuota(db, userId, LIMITS)
  return quota.limit
}

const invitedOf = async (db: D1Database, userId: string, role = 'user') => {
  const status = await readInviteStatus(db, userId, role)
  return status.invited
}

const withUser = async (id: string) => {
  const { db } = migratedD1()
  await db
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values (?1, ?1, ?1 || '@x', 1, 0, 0)`
    )
    .bind(id)
    .run()
  return db
}

test('allowing a request invites the account at the invited limit', async () => {
  const db = await withUser('u')
  expect(await readInviteStatus(db, 'u', 'user')).toEqual({
    invited: false,
    requested: false,
  })
  expect(await limitOf(db, 'u')).toBe(1)

  await requestInvite(db, 'u', 'Anime songs', 1)
  expect(await readInviteStatus(db, 'u', 'user')).toEqual({
    invited: false,
    requested: true,
  })

  expect(await decideInvite(db, 'u', 'allowed', BY)).toBe(true)
  expect(await readInviteStatus(db, 'u', 'user')).toEqual({
    invited: true,
    requested: true,
  })
  expect(await limitOf(db, 'u')).toBe(5)
})

test('a dismissed request stays dismissed when asked again, and gives no songs', async () => {
  const db = await withUser('u')
  await requestInvite(db, 'u', 'first', 1)
  expect(await decideInvite(db, 'u', 'dismissed', BY)).toBe(true)
  await requestInvite(db, 'u', 'second', 3)
  const row = await db
    .prepare(
      `select "note", "status" from "inviteRequest" where "userId" = 'u'`
    )
    .first()
  expect(row).toEqual({ note: 'first', status: 'dismissed' })
  expect(await invitedOf(db, 'u')).toBe(false)
  expect(await limitOf(db, 'u')).toBe(1)
})

test('deciding a request nobody made changes nothing', async () => {
  const db = await withUser('u')
  expect(await decideInvite(db, 'u', 'allowed', BY)).toBe(false)
  expect(await invitedOf(db, 'u')).toBe(false)
})

test('an admin counts as invited without a request', async () => {
  const db = await withUser('a')
  expect(await invitedOf(db, 'a', 'admin')).toBe(true)
})

test('notes are optional, trimmed, and capped', () => {
  expect(parseInviteNote({})).toBe('')
  expect(parseInviteNote(null)).toBe('')
  expect(parseInviteNote({ note: '  hi  ' })).toBe('hi')
  expect(parseInviteNote({ note: 3 })).toBeNull()
  expect(parseInviteNote({ note: 'x'.repeat(INVITE_NOTE_MAX + 1) })).toBeNull()
})

test('an admin note is set, replaced and removed by an empty one', async () => {
  const db = await withUser('u')
  const noteOf = async () =>
    await db
      .prepare(`select "note" from "adminNote" where "userId" = 'u'`)
      .first('note')
  expect(await setAdminNote(db, 'u', { note: ' Cousin ' }, BY)).toBe(true)
  expect(await noteOf()).toBe('Cousin')
  expect(await setAdminNote(db, 'u', { note: 'Work friend' }, BY)).toBe(true)
  expect(await noteOf()).toBe('Work friend')
  expect(await setAdminNote(db, 'u', { note: '' }, BY)).toBe(true)
  expect(await noteOf()).toBeNull()
  expect(await setAdminNote(db, 'u', { note: 5 }, BY)).toBe(false)
})
