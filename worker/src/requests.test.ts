import type { Database } from 'bun:sqlite'
import { beforeEach, expect, test } from 'bun:test'

import {
  clearReadNotices,
  markNoticesSeen,
  pruneNoticeReads,
  readNotices,
} from './notices'
import { getQuota } from './quota'
import {
  decideRequest,
  latestRequest,
  parseRequestNote,
  sendRequest,
} from './requests'
import { migratedD1 } from './test-d1'

let db: D1Database
let sqlite: Database
const LIMITS = { network: 30, site: 1000, user: 5 }
const now = new Date('2026-10-27T10:00:00Z')

beforeEach(() => {
  ;({ db, sqlite } = migratedD1())
  const user = sqlite.prepare(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned") values (?, ?, ?, 1, 0, 0, ?, 0)`
  )
  user.run('u1', 'Mika', 'a@x', 'user')
  user.run('admin', 'Owner', 'b@x', 'admin')
})

test('one open request at a time; approving gives the songs a day, and the account can ask again after', async () => {
  expect(parseRequestNote({ note: '  ' })).toBeNull()
  expect(parseRequestNote({ note: 'I sing with friends' })).toBe(
    'I sing with friends'
  )
  expect(await sendRequest(db, 'u1', 'I sing with friends', 1)).toBe(true)
  expect(await sendRequest(db, 'u1', 'again', 2)).toBe(false)
  expect(await latestRequest(db, 'u1')).toMatchObject({ status: 'open' })

  const id = Number(
    sqlite.query(`select "id" as "value" from "quotaRequest"`).values()[0]?.[0]
  )
  expect(
    await decideRequest(
      db,
      id,
      { approve: true, dailyLimit: 12 },
      { adminId: 'admin', now: 3 }
    )
  ).toBe(true)
  expect(await latestRequest(db, 'u1')).toEqual({
    createdAt: 1,
    decidedAt: 3,
    granted: 12,
    status: 'approved',
  })
  expect(await getQuota(db, 'u1', LIMITS, now)).toMatchObject({ limit: 12 })
  // Decided once: deciding again changes nothing
  expect(
    await decideRequest(
      db,
      id,
      { approve: false },
      { adminId: 'admin', now: 4 }
    )
  ).toBe(false)
  expect(await sendRequest(db, 'u1', 'a bit more please', 5)).toBe(true)
})

test("an admin's notices: new messages, reports and requests are unread until they're opened", async () => {
  sqlite.run(
    `insert into "contactMessage" ("createdAt", "sender", "network", "subject", "message") values (10, 'u:u1', 'n', 'Hi', 'hello')`
  )
  sqlite.run(
    `insert into "report" ("id", "videoId", "message", "userId", "createdAt") values ('r1', 'abcdefghijk', 'off by a line', 'u1', 20)`
  )
  await sendRequest(db, 'u1', 'more please', 30)
  const first = await readNotices(db, 'admin', 100)
  expect(first.unread).toBe(3)
  expect(first.notices.map((n) => [n.kind, n.name])).toEqual([
    ['request', 'Mika'],
    ['report', 'Mika'],
    ['message', 'Mika'],
  ])
  await markNoticesSeen(db, 'admin', 30)
  const seen = await readNotices(db, 'admin', 100)
  expect(seen.unread).toBe(0)
  sqlite.run(
    `insert into "contactMessage" ("createdAt", "sender", "network", "subject", "message") values (40, 'd:guest', 'n', 'Yo', 'hey')`
  )
  const later = await readNotices(db, 'admin', 100)
  expect(later.unread).toBe(1)
  expect(later.notices[0]).toMatchObject({ kind: 'message', name: '' })
})

const noticeIds = async (adminId: string) => {
  const { notices } = await readNotices(db, adminId, 100)
  return notices.map((n) => n.id)
}

test("an admin's own report isn't a notice to them; a guest's and another admin's are", async () => {
  sqlite.run(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned") values ('admin2', 'Helper', 'c@x', 1, 0, 0, 'admin', 0)`
  )
  sqlite.run(
    `insert into "report" ("id", "videoId", "message", "userId", "guestKey", "createdAt") values
       ('own', 'abcdefghijk', 'mine', 'admin', null, 10),
       ('guest', 'abcdefghijk', 'theirs', null, 'g1', 20)`
  )
  expect(await noticeIds('admin')).toEqual(['guest'])
  expect(await noticeIds('admin2')).toEqual(['guest', 'own'])
})

const DAY = 86_400_000

const guestMessage = (at: number) =>
  sqlite.run(
    `insert into "contactMessage" ("createdAt", "sender", "network", "subject", "message") values (?, 'd:guest', 'n', 'Hi', 'hello')`,
    [at]
  )

// What the bell shows the admin at `at`: each notice's arrival and whether it's unread
const shown = async (at: number) => {
  const { notices } = await readNotices(db, 'admin', at)
  return notices.map((n) => [n.at, n.unread])
}

test('a read notice leaves the bell 3 days after it was read, or at Clear Read; an unread one stays', async () => {
  guestMessage(10)
  // Read long after it arrived: the 3 days count from the reading
  await markNoticesSeen(db, 'admin', 5 * DAY)
  expect(await shown(8 * DAY - 1)).toEqual([[10, false]])
  expect(await shown(8 * DAY + 1)).toEqual([])

  guestMessage(9 * DAY)
  await markNoticesSeen(db, 'admin', 9 * DAY + 1)
  guestMessage(9 * DAY + 2)
  // Clear Read takes the read one and leaves the one that came after the bell was opened
  await clearReadNotices(db, 'admin', 9 * DAY + 3)
  expect(await shown(9 * DAY + 4)).toEqual([[9 * DAY + 2, true]])
  // Once read, it isn't taken by the earlier Clear Read
  await markNoticesSeen(db, 'admin', 9 * DAY + 5)
  expect(await shown(9 * DAY + 6)).toEqual([[9 * DAY + 2, false]])

  // The cron's prune leaves what the bell shows unchanged
  await pruneNoticeReads(db, 20 * DAY)
  expect(await shown(20 * DAY)).toEqual([])
})
