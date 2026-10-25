import { expect, test } from 'bun:test'

import {
  EXPIRE_DAYS,
  REPORTS_PER_DAY,
  REPORT_MESSAGE_MAX,
  RESOLUTION_MAX,
  dropReport,
  expireReports,
  isUninformative,
  listFixes,
  listOpenReports,
  listReports,
  markFixes,
  openReportOf,
  parseDrop,
  parseFixMarks,
  parseReport,
  parseResolution,
  parseReview,
  reopenReport,
  reportAllowed,
  resolveReport,
  reviewReport,
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

const addUsers = async (db: D1Database, ...ids: string[]) => {
  await Promise.all(
    ids.map(
      async (id) =>
        await db
          .prepare(
            `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
             values (?1, ?1, ?1 || '@x', 1, 0, 0)`
          )
          .bind(id)
          .run()
    )
  )
}

test('a report keeps a trimmed message and a time to a tenth; anything off is refused', () => {
  expect(
    parseReport({
      atSeconds: 61.234,
      message: '  wrong furigana  ',
      version: 2,
      videoId: '6rG_irmOQsM',
    })
  ).toEqual({
    ok: true,
    report: {
      atSeconds: 61.2,
      build: null,
      message: 'wrong furigana',
      version: 2,
      videoId: '6rG_irmOQsM',
    },
  })
  const refused = { code: 'bad_request', ok: false } as const
  expect(parseReport({ message: '   ', videoId: '6rG_irmOQsM' })).toEqual(
    refused
  )
  expect(
    parseReport({
      message: 'x'.repeat(REPORT_MESSAGE_MAX + 1),
      videoId: '6rG_irmOQsM',
    })
  ).toEqual(refused)
  expect(parseReport({ message: 'wrong', videoId: 'not a video' })).toEqual(
    refused
  )
  expect(
    parseReport({ atSeconds: -1, message: 'wrong', videoId: '6rG_irmOQsM' })
  ).toEqual(refused)
  expect(
    parseReport({ message: 'wrong', version: 1.5, videoId: '6rG_irmOQsM' })
  ).toEqual(refused)
})

test('a message that says nothing is refused as uninformative; short real reports pass', () => {
  for (const junk of [
    'x',
    'aaaa',
    'ああああ',
    'asdf',
    'ASDFGHJKL',
    'qwer qwer',
    'zxcv',
    'test',
    'Test test test',
    'テスト',
    '!!!???',
    '😡😡😡',
    '123',
    'https://youtu.be/6rG_irmOQsM',
    'www.example.com/a',
  ]) {
    expect([junk, isUninformative(junk)]).toEqual([junk, true])
  }
  for (const real of [
    'wrong',
    'out of sync',
    '歌詞ずれ',
    'romaji wrong',
    '遅い',
    'ok',
    'test: romaji wrong at chorus',
    'https://youtu.be/6rG_irmOQsM lyrics late',
    '1:23 off',
  ]) {
    expect([real, isUninformative(real)]).toEqual([real, false])
  }
  expect(parseReport({ message: 'asdf', videoId: '6rG_irmOQsM' })).toEqual({
    code: 'uninformative',
    ok: false,
  })
})

test('an account may send a few reports a day', async () => {
  const { db } = migratedD1()
  await addUsers(db, 'u')
  const now = 1_000_000_000
  // Each on its own song: one open report per song
  await Promise.all(
    Array.from({ length: REPORTS_PER_DAY }, async (_, index) => {
      await saveReport(
        db,
        'u',
        { ...REPORT, videoId: `song${String(index).padStart(7, '0')}` },
        '',
        now
      )
    })
  )
  expect(await reportAllowed(db, 'u', now)).toBe(false)
  // A day later it may report again
  expect(await reportAllowed(db, 'u', now + 86_400_001)).toBe(true)
})

test('resolving records when, the fixing version and the note; reopening clears them; an unknown id changes nothing', async () => {
  const { db } = migratedD1()
  await addUsers(db, 'u')
  await saveReport(db, 'u', REPORT, '', 1)
  await saveReport(
    db,
    'u',
    { ...REPORT, message: 'Later', videoId: 'Dta27KjGpJs' },
    '',
    2
  )
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
  expect(await reopenReport(db, id)).toBe('reopened')
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
  expect(await reopenReport(db, 'no-such-id')).toBe('not_found')
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
  ).toEqual({
    note: null,
    reportedVersion: 0,
    version: 0,
  })
  expect(parseResolution({ version: 1.5 })).toBeNull()
  expect(parseResolution({ note: 'x'.repeat(RESOLUTION_MAX + 1) })).toBeNull()
  expect(parseResolution({ note: 7 })).toBeNull()
})

const DAY = 86_400_000
const NOW = 100 * DAY

const fixture = async () => {
  const { db } = migratedD1()
  await addUsers(db, 'me', 'other')
  // Sends a report on `videoId` and resolves it; answers its id
  const reportAndResolve = async (
    videoId: string,
    {
      reportedVersion = 2,
      version = 3,
      at = NOW - DAY,
    }: { reportedVersion?: number; version?: number | null; at?: number } = {}
  ) => {
    await saveReport(db, 'me', { ...REPORT, videoId }, '', at - 1)
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
  expect(await listFixes(db, 'me')).toEqual([
    { fixedAt: NOW - DAY, seen: false, videoId: '6rG_irmOQsM' },
  ])
})

test('a resolve that kept the reported lyrics, or recorded no version, tells nobody', async () => {
  const { db, reportAndResolve } = await fixture()
  await reportAndResolve('6rG_irmOQsM', { reportedVersion: 3, version: 3 })
  await reportAndResolve('Dta27KjGpJs', { reportedVersion: 0, version: 0 })
  await reportAndResolve('aaaaaaaaaaa', { version: null })
  expect(await listFixes(db, 'me')).toEqual([])
})

test('seen stays listed and counts as read; dismissed is gone, and leaves a later report of the song alone', async () => {
  const { db, reportAndResolve } = await fixture()
  await reportAndResolve('6rG_irmOQsM')
  const marks = { upTo: NOW - DAY, videoIds: ['6rG_irmOQsM'] }
  await markFixes(db, 'me', marks, 'seen', NOW)
  expect(await listFixes(db, 'me')).toEqual([
    { fixedAt: NOW - DAY, seen: true, videoId: '6rG_irmOQsM' },
  ])
  // Reported again, still open, when the first fix is dismissed
  await saveReport(db, 'me', REPORT, '', NOW - 10)
  await markFixes(db, 'me', marks, 'dismissed', NOW)
  expect(await listFixes(db, 'me')).toEqual([])
  const reports = await listReports(db)
  const open = reports.find((row) => row.resolvedAt === null)
  await resolveReport(
    db,
    String(open?.id),
    { note: null, reportedVersion: 3, version: 4 },
    NOW
  )
  expect(await listFixes(db, 'me')).toEqual([
    { fixedAt: NOW, seen: false, videoId: '6rG_irmOQsM' },
  ])
})

test('a fix stays until dismissed, however long ago it was resolved', async () => {
  const { db, reportAndResolve } = await fixture()
  await reportAndResolve('6rG_irmOQsM', { at: NOW })
  expect(await listFixes(db, 'me')).toHaveLength(1)
})

test("another account neither sees nor dismisses someone's fix", async () => {
  const { db, reportAndResolve } = await fixture()
  await reportAndResolve('6rG_irmOQsM')
  expect(await listFixes(db, 'other')).toEqual([])
  await markFixes(
    db,
    'other',
    { upTo: NOW, videoIds: ['6rG_irmOQsM'] },
    'dismissed',
    NOW
  )
  expect(await listFixes(db, 'me')).toHaveLength(1)
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

const rowOf = async (db: D1Database, id: string) => {
  const rows = await listReports(db)
  return rows.find((row) => row.id === id)
}

test('a dropped report tells nobody, leaves the open list, and is resolved or dropped, never both', async () => {
  const { db, reportAndResolve } = await fixture()
  const id = await reportAndResolve('6rG_irmOQsM')
  expect(await listFixes(db, 'me')).toHaveLength(1)
  // FIXED itself refuses a dropped row, even one written by hand with its resolve still on it
  await db
    .prepare(`update "report" set "droppedAt" = ?1 where "id" = ?2`)
    .bind(NOW, id)
    .run()
  expect(await listFixes(db, 'me')).toEqual([])
  await dropReport(db, id, { note: null, reason: 'nothing_found' }, NOW)
  expect(await listFixes(db, 'me')).toEqual([])
  await saveReport(db, 'me', { ...REPORT, videoId: 'Dta27KjGpJs' }, '', NOW)
  const open = await listOpenReports(db)
  expect(open.map((row) => row.videoId)).toEqual(['Dta27KjGpJs'])
  const dropped = await rowOf(db, id)
  expect(dropped).toMatchObject({
    dropReason: 'nothing_found',
    droppedAt: NOW,
    resolvedAt: null,
    resolvedVersion: null,
  })
  // Resolving a dropped report undoes the drop
  await resolveReport(
    db,
    id,
    { note: null, reportedVersion: 2, version: 3 },
    NOW
  )
  expect(await rowOf(db, id)).toMatchObject({
    dropReason: null,
    droppedAt: null,
    resolvedVersion: 3,
  })
})

test('reopen clears a drop, and the report is open again', async () => {
  const { db } = await fixture()
  await saveReport(db, 'me', REPORT, '', NOW)
  const [row] = await listOpenReports(db)
  const id = String(row?.id)
  await dropReport(
    db,
    id,
    { note: 'same as another', reason: 'duplicate' },
    NOW
  )
  expect(await listOpenReports(db)).toEqual([])
  expect(await reopenReport(db, id)).toBe('reopened')
  expect(await rowOf(db, id)).toMatchObject({
    dropReason: null,
    droppedAt: null,
    id,
    resolution: null,
  })
  expect(await listOpenReports(db)).toHaveLength(1)
  expect(
    await dropReport(db, 'no-such-id', { note: null, reason: 'duplicate' }, NOW)
  ).toBe(false)
})

test('expiry drops a report open for 3 days and keeps a 2-day-old one; closed reports are left alone', async () => {
  const { db, reportAndResolve } = await fixture()
  await saveReport(
    db,
    'me',
    { ...REPORT, videoId: 'aaaaaaaaaaa' },
    '',
    NOW - EXPIRE_DAYS * DAY
  )
  await saveReport(
    db,
    'me',
    { ...REPORT, videoId: 'bbbbbbbbbbb' },
    '',
    NOW - 2 * DAY
  )
  await reportAndResolve('ccccccccccc', { at: NOW - 5 * DAY })
  expect(await expireReports(db, NOW)).toBe(1)
  expect(await expireReports(db, NOW)).toBe(0)
  const rows = await listReports(db)
  expect(rows.find((row) => row.videoId === 'aaaaaaaaaaa')).toMatchObject({
    dropReason: 'expired',
    droppedAt: NOW,
  })
  expect(rows.find((row) => row.videoId === 'ccccccccccc')).toMatchObject({
    dropReason: null,
    resolvedVersion: 3,
  })
  const open = await listOpenReports(db)
  expect(open.map((row) => row.videoId)).toEqual(['bbbbbbbbbbb'])
})

test('expiry leaves a report the fixer handed to a human', async () => {
  const { db } = await fixture()
  await saveReport(db, 'me', REPORT, '', NOW - 5 * DAY)
  const [row] = await listReports(db)
  expect(await reviewReport(db, String(row?.id), null, NOW - 4 * DAY)).toBe(
    true
  )
  expect(await expireReports(db, NOW)).toBe(0)
  expect(await listOpenReports(db)).toEqual([])
  expect((await listReports(db))[0]).toMatchObject({
    droppedAt: null,
    reviewAt: NOW - 4 * DAY,
  })
})

test('a review note is optional and short', () => {
  expect(parseReview({})).toEqual({ note: null })
  expect(parseReview({ note: '  Audit clean ' })).toEqual({
    note: 'Audit clean',
  })
  expect(parseReview({ note: 'x'.repeat(RESOLUTION_MAX + 1) })).toBeNull()
  expect(parseReview(null)).toBeNull()
})

test('a drop names a known reason; the note is optional and short', () => {
  expect(parseDrop({ reason: 'no_lyrics' })).toEqual({
    note: null,
    reason: 'no_lyrics',
  })
  expect(parseDrop({ note: ' dup of 6rG ', reason: 'duplicate' })).toEqual({
    note: 'dup of 6rG',
    reason: 'duplicate',
  })
  expect(parseDrop({ reason: 'bored' })).toBeNull()
  expect(parseDrop({})).toBeNull()
  expect(
    parseDrop({ note: 'x'.repeat(RESOLUTION_MAX + 1), reason: 'duplicate' })
  ).toBeNull()
})

test('one open report per account per song: a second is refused until the first is resolved or dropped', async () => {
  const { db } = migratedD1()
  await addUsers(db, 'me', 'other')
  expect(await saveReport(db, 'me', REPORT, '', NOW)).toBe(true)
  expect(await saveReport(db, 'me', REPORT, '', NOW + 1)).toBe(false)
  expect(await openReportOf(db, 'me', REPORT.videoId)).toEqual({
    createdAt: NOW,
    message: REPORT.message,
  })
  // Another song, or another account on the same song, is its own report
  expect(
    await saveReport(db, 'me', { ...REPORT, videoId: 'Dta27KjGpJs' }, '', NOW)
  ).toBe(true)
  expect(await saveReport(db, 'other', REPORT, '', NOW)).toBe(true)
  const reports = await listReports(db)
  const first = reports.find(
    (row) => row.videoId === REPORT.videoId && row.email === 'me@x'
  )
  const id = String(first?.id)
  await dropReport(db, id, { note: null, reason: 'nothing_found' }, NOW + 2)
  expect(await openReportOf(db, 'me', REPORT.videoId)).toBeNull()
  expect(await saveReport(db, 'me', REPORT, '', NOW + 3)).toBe(true)
  // The dropped one can't be reopened beside the newer open one
  expect(await reopenReport(db, id)).toBe('conflict')
})
