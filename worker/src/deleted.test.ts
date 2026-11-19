import { expect, test } from 'bun:test'

import { changeFeedback, listResolved, saveFeedback } from './feedback'
import worker from './index'
import {
  dropReport,
  listFixes,
  listOpenReports,
  resolveReport,
  saveReport,
} from './reports'
import { migratedD1, sessionCookie } from './test-d1'

const SECRET = 'test-secret-test-secret-test-secret'

// The Worker over a migrated database with an admin, 'boss', signed in, and a listener, 'me'
const setup = async () => {
  const { db } = migratedD1()
  await db
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role")
       values ('boss', 'Boss', 'boss@x', 1, 0, 0, 'admin'), ('me', 'Me', 'me@x', 1, 0, 0, 'user')`
    )
    .run()
  const cookie = await sessionCookie(db, SECRET, 'boss')
  const env = {
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: 'http://localhost:5173',
    DB: db,
    GOOGLE_CLIENT_ID: 'x',
    GOOGLE_CLIENT_SECRET: 'x',
    INTERNAL_SECRET: 'internal',
    TRUSTED_ORIGINS: 'http://localhost:5173',
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the admin routes never call it
  const ctx = { waitUntil: () => null } as unknown as ExecutionContext
  const send = async (method: string, path: string, body?: unknown) =>
    await worker.fetch(
      new Request(`http://localhost/api/admin${path}`, {
        body: body === undefined ? null : JSON.stringify(body),
        headers: { 'content-type': 'application/json', cookie },
        method,
      }),
      env,
      ctx
    )
  // The answer's status
  const status = async (method: string, path: string, body?: unknown) => {
    const response = await send(method, path, body)
    return response.status
  }
  // One field of the answer's JSON
  const read = async (
    path: string,
    key: string,
    method = 'GET'
  ): Promise<unknown> => {
    const response = await send(method, path)
    const json: unknown = await response.json()
    return typeof json === 'object' && json !== null
      ? Reflect.get(json, key)
      : null
  }
  // A report by 'me' on `videoId`; answers its id
  const report = async (videoId: string) => {
    await saveReport(
      db,
      'me',
      { atSeconds: 1, build: null, message: 'Off sync', version: 2, videoId },
      '',
      Date.now()
    )
    const open = await listOpenReports(db)
    return String(open.find((row) => row.videoId === videoId)?.id)
  }
  return { db, read, report, status }
}

test('a closed report can be deleted and restored; deleted, it is in no list or count and tells its reporter nothing', async () => {
  const { db, read, report, status } = await setup()
  const fixed = await report('6rG_irmOQsM')
  const open = await report('Dta27KjGpJs')
  await resolveReport(
    db,
    fixed,
    { note: null, reportedVersion: 2, version: 3 },
    Date.now()
  )
  expect(await listFixes(db, 'me', Date.now())).toHaveLength(1)
  // An open report is dropped first, never deleted
  expect(await status('DELETE', `/reports/${open}`)).toBe(404)
  expect(await status('DELETE', `/reports/${fixed}`)).toBe(204)
  expect(await read('/reports', 'reports')).toHaveLength(1)
  expect(await read('/reports', 'counts')).toEqual({
    dropped: 0,
    open: 1,
    resolved: 0,
    review: 0,
  })
  expect(await listFixes(db, 'me', Date.now())).toEqual([])
  // Nothing changes a deleted report, the fixer's resolve included
  expect(await status('POST', `/reports/${fixed}/reopen`)).toBe(404)
  expect(
    await resolveReport(
      db,
      fixed,
      { note: null, reportedVersion: 2, version: 4 },
      Date.now()
    )
  ).toBe(false)
  expect(await status('POST', '/reports/restore', { ids: [fixed] })).toBe(204)
  expect(await read('/reports', 'counts')).toMatchObject({ resolved: 1 })
  expect(await listFixes(db, 'me', Date.now())).toHaveLength(1)
})

test('Clear All deletes every dropped report and nothing else, and its ids undo it', async () => {
  const { db, read, report, status } = await setup()
  const first = await report('6rG_irmOQsM')
  const second = await report('Dta27KjGpJs')
  await report('EaA6NlH80wg')
  await dropReport(db, first, { note: null, reason: 'duplicate' }, 1)
  await dropReport(db, second, { note: null, reason: 'duplicate' }, 1)
  const cleared = await read('/reports/clear-dropped', 'ids', 'POST')
  expect(cleared).toEqual(expect.arrayContaining([first, second]))
  expect(await read('/reports', 'counts')).toEqual({
    dropped: 0,
    open: 1,
    resolved: 0,
    review: 0,
  })
  expect(await status('POST', '/reports/restore', { ids: cleared })).toBe(204)
  expect(await read('/reports', 'counts')).toMatchObject({ dropped: 2 })
  // Report ids are text
  expect(await status('POST', '/reports/restore', { ids: [1] })).toBe(400)
})

test('deleted feedback leaves the admin list and its sender’s notifications; restored, both come back', async () => {
  const { db, read, status } = await setup()
  await saveFeedback(
    db,
    { anonymous: false, message: 'Love it', subject: 'Hi' },
    'me',
    1
  )
  await changeFeedback(db, 1, 'resolve', Date.now())
  expect(await listResolved(db, 'me', Date.now())).toHaveLength(1)
  expect(await status('DELETE', '/feedback/1')).toBe(204)
  expect(await read('/feedback', 'feedback')).toEqual([])
  expect(await listResolved(db, 'me', Date.now())).toEqual([])
  expect(await changeFeedback(db, 1, 'reopen', Date.now())).toBe(false)
  expect(await status('POST', '/feedback/restore', { ids: [1] })).toBe(204)
  expect(await read('/feedback', 'feedback')).toHaveLength(1)
  expect(await listResolved(db, 'me', Date.now())).toHaveLength(1)
})

test('a deleted contact message leaves the list until restored', async () => {
  const { db, read, status } = await setup()
  await db
    .prepare(
      `insert into "contactMessage" ("createdAt", "network", "subject", "message") values (1, 'n', 'Hi', 'Hello')`
    )
    .run()
  expect(await status('DELETE', '/messages/1')).toBe(204)
  expect(await status('DELETE', '/messages/1')).toBe(404)
  expect(await read('/messages', 'messages')).toEqual([])
  expect(await status('POST', '/messages/restore', { ids: [1] })).toBe(204)
  expect(await read('/messages', 'messages')).toHaveLength(1)
})
