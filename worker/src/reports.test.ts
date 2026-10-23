import { expect, test } from 'bun:test'

import {
  FIX_DAYS,
  REPORT_LIMITS,
  REPORT_MESSAGE_MAX,
  RESOLUTION_MAX,
  guestKeyOf,
  listFixes,
  listReports,
  markFixes,
  parseFixMarks,
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
    await resolveReport(
      db,
      id,
      { note: 'Fixed in align', reportedVersion: null, version: 4 },
      3
    )
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
    await resolveReport(
      db,
      'no-such-id',
      { note: null, reportedVersion: null, version: null },
      4
    )
  ).toBe(false)
  expect(await reopenReport(db, 'no-such-id')).toBe(false)
})

test('a resolution may be empty; a fractional version or an overlong note is refused', () => {
  expect(parseResolution({})).toEqual({
    note: null,
    reportedVersion: null,
    version: null,
  })
  // Most songs never got new lyrics: their live version is the first, 0
  expect(
    parseResolution({ note: '  ', reportedVersion: 0, version: 0 })
  ).toEqual({ note: null, reportedVersion: 0, version: 0 })
  expect(parseResolution({ version: 1.5 })).toBeNull()
  expect(parseResolution({ note: 'x'.repeat(RESOLUTION_MAX + 1) })).toBeNull()
  expect(parseResolution({ note: 7 })).toBeNull()
})

const DAY = 86_400_000
const NOW = 100 * DAY

const fixture = async () => {
  const { db } = migratedD1()
  await db
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values ('me', 'Me', 'me@x', 1, 0, 0), ('other', 'Other', 'other@x', 1, 0, 0)`
    )
    .run()
  const me = { id: 'me', kind: 'user' } as const
  // Sends a report on `videoId` and resolves it; answers its id
  const reportAndResolve = async (
    videoId: string,
    {
      reportedVersion = 2,
      version = 3,
      at = NOW - DAY,
    }: { reportedVersion?: number; version?: number | null; at?: number } = {}
  ) => {
    await saveReport(db, me, { ...REPORT, videoId }, '', at - 1)
    const reports = await listReports(db)
    const row = reports.find(
      (listed) => listed.videoId === videoId && listed.resolvedAt === null
    )
    const id = String(row?.id)
    await resolveReport(db, id, { note: null, reportedVersion, version }, at)
    return id
  }
  return { db, reportAndResolve }
}

test('a report resolved with new lyrics is one notification for its reporter, however often they reported the song', async () => {
  const { db, reportAndResolve } = await fixture()
  await reportAndResolve('6rG_irmOQsM')
  await reportAndResolve('6rG_irmOQsM', { at: NOW - 2 * DAY })
  expect(await listFixes(db, 'me', NOW)).toEqual([
    { fixedAt: NOW - DAY, seen: false, videoId: '6rG_irmOQsM' },
  ])
})

test('a resolve that kept the reported lyrics, or recorded no version, tells nobody', async () => {
  const { db, reportAndResolve } = await fixture()
  await reportAndResolve('6rG_irmOQsM', { reportedVersion: 3, version: 3 })
  await reportAndResolve('Dta27KjGpJs', { reportedVersion: 0, version: 0 })
  await reportAndResolve('aaaaaaaaaaa', { version: null })
  expect(await listFixes(db, 'me', NOW)).toEqual([])
})

test('seen stays listed and counts as read; dismissed is gone, and leaves a later report of the song alone', async () => {
  const { db, reportAndResolve } = await fixture()
  await reportAndResolve('6rG_irmOQsM')
  const marks = { upTo: NOW - DAY, videoIds: ['6rG_irmOQsM'] }
  await markFixes(db, 'me', marks, 'seen', NOW)
  expect(await listFixes(db, 'me', NOW)).toEqual([
    { fixedAt: NOW - DAY, seen: true, videoId: '6rG_irmOQsM' },
  ])
  // Reported again, still open, when the first fix is dismissed
  await saveReport(db, { id: 'me', kind: 'user' }, REPORT, '', NOW - 10)
  await markFixes(db, 'me', marks, 'dismissed', NOW)
  expect(await listFixes(db, 'me', NOW)).toEqual([])
  const reports = await listReports(db)
  const open = reports.find((row) => row.resolvedAt === null)
  await resolveReport(
    db,
    String(open?.id),
    { note: null, reportedVersion: 3, version: 4 },
    NOW
  )
  expect(await listFixes(db, 'me', NOW + 1)).toEqual([
    { fixedAt: NOW, seen: false, videoId: '6rG_irmOQsM' },
  ])
})

test('a fix drops out after 30 days, read or not', async () => {
  const { db, reportAndResolve } = await fixture()
  await reportAndResolve('6rG_irmOQsM', { at: NOW })
  expect(await listFixes(db, 'me', NOW + FIX_DAYS * DAY - 1)).toHaveLength(1)
  expect(await listFixes(db, 'me', NOW + FIX_DAYS * DAY)).toEqual([])
})

test("another account neither sees nor dismisses someone's fix", async () => {
  const { db, reportAndResolve } = await fixture()
  await reportAndResolve('6rG_irmOQsM')
  expect(await listFixes(db, 'other', NOW)).toEqual([])
  await markFixes(
    db,
    'other',
    { upTo: NOW, videoIds: ['6rG_irmOQsM'] },
    'dismissed',
    NOW
  )
  expect(await listFixes(db, 'me', NOW)).toHaveLength(1)
})

test('marks name real video ids, at most 50, with the newest fix shown', () => {
  expect(parseFixMarks({ upTo: 5, videoIds: ['6rG_irmOQsM'] })).toEqual({
    upTo: 5,
    videoIds: ['6rG_irmOQsM'],
  })
  expect(parseFixMarks({ upTo: 5, videoIds: [] })).toBeNull()
  expect(parseFixMarks({ upTo: 5, videoIds: ["x' or 1=1"] })).toBeNull()
  expect(parseFixMarks({ videoIds: ['6rG_irmOQsM'] })).toBeNull()
  expect(
    parseFixMarks({
      upTo: 5,
      videoIds: Array.from({ length: 51 }, () => '6rG_irmOQsM'),
    })
  ).toBeNull()
})
