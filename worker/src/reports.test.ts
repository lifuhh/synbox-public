import { expect, test } from 'bun:test'

import {
  REPORT_LIMITS,
  REPORT_MESSAGE_MAX,
  RESOLUTION_MAX,
  guestKeyOf,
  listReports,
  parseReport,
  parseResolution,
  reopenReport,
  reportAllowed,
  resolveReport,
  saveReport,
} from './reports'
import type { Report } from './reports'
import { migratedD1 } from './test-d1'

const REPORT: Report = {
  atSeconds: 61.2,
  build: null,
  message: 'Romaji is a line behind',
  version: null,
  videoId: '6rG_irmOQsM',
}

test('a report keeps a trimmed message and a time to a tenth; anything off is refused', () => {
  expect(
    parseReport({
      atSeconds: 61.234,
      message: '  wrong furigana  ',
      videoId: '6rG_irmOQsM',
    })
  ).toEqual({
    atSeconds: 61.2,
    build: null,
    message: 'wrong furigana',
    version: null,
    videoId: '6rG_irmOQsM',
  })
  expect(parseReport({ message: '   ', videoId: '6rG_irmOQsM' })).toBeNull()
  expect(
    parseReport({
      message: 'x'.repeat(REPORT_MESSAGE_MAX + 1),
      videoId: '6rG_irmOQsM',
    })
  ).toBeNull()
  expect(parseReport({ message: 'x', videoId: 'not a video' })).toBeNull()
  expect(
    parseReport({ atSeconds: -1, message: 'x', videoId: '6rG_irmOQsM' })
  ).toBeNull()
  expect(
    parseReport({ message: 'x', version: 1.5, videoId: '6rG_irmOQsM' })
  ).toBeNull()
})

test('a guest is capped per day, and guests together are capped too; an account has its own cap', async () => {
  const { db } = migratedD1()
  const now = 1_000_000_000
  const guest = { key: 'a', kind: 'guest' } as const
  expect(await reportAllowed(db, guest, now)).toBe(true)
  await Promise.all(
    Array.from({ length: REPORT_LIMITS.guest }, async () => {
      await saveReport(db, guest, REPORT, '', now)
    })
  )
  expect(await reportAllowed(db, guest, now)).toBe(false)
  // A day later the same guest may report again
  expect(await reportAllowed(db, guest, now + 86_400_001)).toBe(true)
  await Promise.all(
    Array.from({ length: REPORT_LIMITS.guestTotal }, async (_, i) => {
      await saveReport(db, { key: `g${i}`, kind: 'guest' }, REPORT, '', now)
    })
  )
  expect(await reportAllowed(db, { key: 'fresh', kind: 'guest' }, now)).toBe(
    false
  )
  await db
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values ('u', 'U', 'u@x', 1, 0, 0)`
    )
    .run()
  expect(await reportAllowed(db, { id: 'u', kind: 'user' }, now)).toBe(true)
})

const key = async (address: string) =>
  await guestKeyOf(
    new Headers({ 'x-nf-client-connection-ip': address }),
    'secret'
  )

test('one home shares a guest key: addresses in the same IPv6 /64 hash alike, others apart', async () => {
  expect(await key('2001:db8:1:2:aaaa::1')).toBe(
    await key('2001:db8:1:2:bbbb::9')
  )
  expect(await key('2001:db8:1:3::1')).not.toBe(await key('2001:db8:1:2::1'))
  expect(await key('203.0.113.7')).not.toBe(await key('203.0.113.8'))
})

test('resolving records when, the fixing version and the note; reopening clears them; an unknown id changes nothing', async () => {
  const { db } = migratedD1()
  const guest = { key: 'a', kind: 'guest' } as const
  await saveReport(db, guest, REPORT, '', 1)
  await saveReport(db, guest, { ...REPORT, message: 'Later' }, '', 2)
  const [newer, older] = await listReports(db)
  const id = String(newer?.id)
  expect(
    await resolveReport(db, id, { note: 'Fixed in align', version: 4 }, 3)
  ).toBe(true)
  // The open report comes first, though the resolved one is newer
  const listed = await listReports(db)
  expect(listed.map((row) => row.id)).toEqual([older?.id, id])
  expect(listed[1]).toMatchObject({
    resolution: 'Fixed in align',
    resolvedAt: 3,
    resolvedVersion: 4,
  })
  expect(await reopenReport(db, id)).toBe(true)
  const [reopened] = await listReports(db)
  expect(reopened).toMatchObject({
    id,
    resolution: null,
    resolvedAt: null,
    resolvedVersion: null,
  })
  expect(
    await resolveReport(db, 'no-such-id', { note: null, version: null }, 4)
  ).toBe(false)
  expect(await reopenReport(db, 'no-such-id')).toBe(false)
})

test('a resolution may be empty; a fractional version or an overlong note is refused', () => {
  expect(parseResolution({})).toEqual({ note: null, version: null })
  expect(parseResolution({ note: '  ', version: 2 })).toEqual({
    note: null,
    version: 2,
  })
  expect(parseResolution({ version: 1.5 })).toBeNull()
  expect(parseResolution({ note: 'x'.repeat(RESOLUTION_MAX + 1) })).toBeNull()
  expect(parseResolution({ note: 7 })).toBeNull()
})
