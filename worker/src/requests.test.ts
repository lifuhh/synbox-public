import type { Database } from 'bun:sqlite'
import { beforeEach, expect, test } from 'bun:test'

import { markNoticesSeen, readNotices } from './notices'
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
const LIMITS = { network: 30, user: 5 }
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

  const id = sqlite.query(`select "id" from "quotaRequest"`).get() as {
    id: number
  }
  expect(
    await decideRequest(
      db,
      id.id,
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
    await decideRequest(db, id.id, { approve: false }, { adminId: 'admin', now: 4 })
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
  const first = await readNotices(db, 'admin')
  expect(first.unread).toBe(3)
  expect(first.notices.map((n) => [n.kind, n.name])).toEqual([
    ['request', 'Mika'],
    ['report', 'Mika'],
    ['message', 'Mika'],
  ])
  await markNoticesSeen(db, 'admin', 30)
  expect((await readNotices(db, 'admin')).unread).toBe(0)
  sqlite.run(
    `insert into "contactMessage" ("createdAt", "sender", "network", "subject", "message") values (40, 'd:guest', 'n', 'Yo', 'hey')`
  )
  const later = await readNotices(db, 'admin')
  expect(later.unread).toBe(1)
  expect(later.notices[0]).toMatchObject({ kind: 'message', name: '' })
})
