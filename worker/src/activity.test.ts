import { expect, test } from 'bun:test'

import { ACTIVE_GAP_MS, touchActive } from './activity'
import { migratedD1 } from './test-d1'

const lastActive = async (db: D1Database) =>
  await db
    .prepare(`select "lastActiveAt" from "accountStats" where "userId" = 'me'`)
    .first<number>('lastActiveAt')

test('last active moves at most once per gap, and keeps the plays already counted', async () => {
  const { db } = migratedD1()
  await db
    .prepare(`insert into "accountStats" ("userId", "plays") values ('me', 4)`)
    .run()
  await touchActive(db, 'me', 1000)
  const first = await lastActive(db)
  await touchActive(db, 'me', 1000 + ACTIVE_GAP_MS - 1)
  const withinGap = await lastActive(db)
  await touchActive(db, 'me', 1000 + ACTIVE_GAP_MS)
  const afterGap = await lastActive(db)
  const plays = await db
    .prepare(`select "plays" from "accountStats" where "userId" = 'me'`)
    .first<number>('plays')
  expect([first, withinGap, afterGap, plays]).toEqual([
    1000,
    1000,
    1000 + ACTIVE_GAP_MS,
    4,
  ])
})
