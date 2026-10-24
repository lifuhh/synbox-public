import { expect, test } from 'bun:test'

import worker from './index'
import { EXPIRE_DAYS, listReports, saveReport } from './reports'
import { migratedD1 } from './test-d1'

// The Worker as Cloudflare runs it: its fetch and scheduled handlers, over a migrated database
const TOKEN = 'fixer-test-token'
const DAY = 86_400_000

const setup = async () => {
  const { db } = migratedD1()
  await db
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values ('me', 'Me', 'me@x', 1, 0, 0)`
    )
    .run()
  const env = {
    ADMIN_EMAILS: '',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
    BETTER_AUTH_URL: 'http://localhost:5173',
    DB: db,
    GOOGLE_CLIENT_ID: 'x',
    GOOGLE_CLIENT_SECRET: 'x',
    GUEST_DAILY_LIMIT: '1',
    GUEST_DAILY_TOTAL: '20',
    INTERNAL_SECRET: 'internal',
    INVITED_DAILY_LIMIT: '5',
    NETWORK_DAILY_LIMIT: '30',
    REPORTS_FIXER_TOKEN: TOKEN,
    TRUSTED_ORIGINS: 'http://localhost:5173',
    USER_DAILY_LIMIT: '10',
  }
  const waits: Promise<unknown>[] = []
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one method the handlers call
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      waits.push(promise)
    },
  } as unknown as ExecutionContext
  const call = async (path: string, init: RequestInit = {}) =>
    await worker.fetch(new Request(`http://localhost${path}`, init), env, ctx)
  const fixer = async (
    path: string,
    { body, auth = `Bearer ${TOKEN}` }: { body?: unknown; auth?: string } = {}
  ) =>
    await call(`/api/fixer${path}`, {
      body: body === undefined ? null : JSON.stringify(body),
      headers: { Authorization: auth, 'content-type': 'application/json' },
      method: body === undefined ? 'GET' : 'POST',
    })
  const status = async (...args: Parameters<typeof fixer>) => {
    const response = await fixer(...args)
    return response.status
  }
  // The fixer's open list, as rows
  const listed = async () => {
    const response = await fixer('/reports')
    const body: unknown = await response.json()
    const reports =
      typeof body === 'object' && body !== null && 'reports' in body
        ? body.reports
        : null
    return Array.isArray(reports)
      ? reports.filter(
          (row): row is Record<string, unknown> =>
            typeof row === 'object' && row !== null
        )
      : []
  }
  return { call, ctx, db, env, listed, status, waits }
}

const REPORT = {
  atSeconds: 61.2,
  build: null,
  message: 'Romaji is a line behind',
  version: 2,
  videoId: '6rG_irmOQsM',
}

test('a guest cannot report', async () => {
  const { call, db } = await setup()
  const response = await call('/api/reports', {
    body: JSON.stringify(REPORT),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  expect(response.status).toBe(401)
  expect(await listReports(db)).toEqual([])
})

test('a guest has no open report to show, whatever the song', async () => {
  const { call } = await setup()
  const response = await call('/api/reports/mine?videoId=6rG_irmOQsM')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ report: null })
})

test('the fixer API refuses a missing, wrong or near-miss token, and any token when the secret is unset', async () => {
  const { env, status } = await setup()
  expect(await status('/reports', { auth: '' })).toBe(401)
  expect(await status('/reports', { auth: 'Bearer nope' })).toBe(401)
  expect(await status('/reports', { auth: `Bearer ${TOKEN}x` })).toBe(401)
  expect(await status('/reports', { auth: TOKEN })).toBe(401)
  expect(await status('/reports')).toBe(200)
  env.REPORTS_FIXER_TOKEN = ''
  expect(await status('/reports', { auth: 'Bearer ' })).toBe(401)
})

test('the fixer lists open reports oldest first, then resolves one and drops another', async () => {
  const { db, listed, status } = await setup()
  await saveReport(db, 'me', REPORT, '', 2000)
  await saveReport(db, 'me', { ...REPORT, videoId: 'Dta27KjGpJs' }, '', 1000)
  const open = await listed()
  expect(open.map((row) => row.videoId)).toEqual(['Dta27KjGpJs', '6rG_irmOQsM'])
  expect(Object.keys(open[0] ?? {}).toSorted()).toEqual([
    'atSeconds',
    'createdAt',
    'id',
    'message',
    'version',
    'videoId',
  ])
  const [first, second] = open.map((row) => String(row.id))
  // A resolve must say which lyrics are live now
  expect(await status(`/reports/${first}/resolve`, { body: {} })).toBe(400)
  expect(
    await status(`/reports/${first}/resolve`, {
      body: { note: 'Re-timed', version: 3 },
    })
  ).toBe(204)
  expect(
    await status(`/reports/${second}/drop`, { body: { reason: 'whatever' } })
  ).toBe(400)
  expect(
    await status(`/reports/${second}/drop`, {
      body: { reason: 'nothing_found' },
    })
  ).toBe(204)
  expect(
    await status('/reports/no-such-id/drop', { body: { reason: 'duplicate' } })
  ).toBe(404)
  expect(await listed()).toEqual([])
  const rows = await listReports(db)
  expect(rows.find((row) => row.id === first)).toMatchObject({
    resolution: 'Re-timed',
    resolvedVersion: 3,
  })
  expect(rows.find((row) => row.id === second)).toMatchObject({
    dropReason: 'nothing_found',
    resolvedAt: null,
  })
})

test('the daily cron expires reports open past 3 days', async () => {
  const { ctx, db, env, waits } = await setup()
  const now = Date.now()
  await saveReport(db, 'me', REPORT, '', now - EXPIRE_DAYS * DAY - 1)
  await saveReport(
    db,
    'me',
    { ...REPORT, videoId: 'Dta27KjGpJs' },
    '',
    now - 2 * DAY
  )
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler reads nothing from the controller
  const controller = { cron: '0 3 * * *' } as unknown as ScheduledController
  worker.scheduled(controller, env, ctx)
  await Promise.all(waits)
  const rows = await listReports(db)
  expect(rows.map((row) => row.dropReason)).toEqual([null, 'expired'])
})
