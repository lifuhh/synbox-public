import { afterEach, expect, mock, spyOn, test } from 'bun:test'

import worker from './index'
import { lyricsRowIds } from './library-songs'
import { migratedD1, sessionCookie } from './test-d1'

const SONG = '6rG_irmOQsM'
const NOT_A_SONG = 'plN7JMbadRg'
const DEVICE = '0f8b3c3e-6a1e-4c62-9d2a-5b7d1f0c9e11'

afterEach(() => {
  mock.restore()
})

// Appwrite as the Worker sees it: a lyrics row for SONG only, or no answer at all
const appwrite = (state: 'up' | 'down') => {
  const asked: string[] = []
  // oxlint-disable-next-line eslint/require-await -- fetch's shape; nothing here waits
  const answer = async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    asked.push(url)
    if (state === 'down') {
      return new Response('', { status: 502 })
    }
    const rows = url.includes(SONG) ? [{ $id: SONG }] : []
    return Response.json({ rows, total: 0 })
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Bun's fetch type adds preconnect, never called here
  spyOn(globalThis, 'fetch').mockImplementation(answer as typeof fetch)
  return asked
}

const SECRET = 'test-secret-test-secret-test-secret'

const setup = async () => {
  const { db } = migratedD1()
  await db
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values ('me', 'Me', 'me@x', 1, 0, 0)`
    )
    .run()
  const cookie = await sessionCookie(db, SECRET, 'me')
  const env = {
    APPWRITE_DATABASE_ID: 'db',
    APPWRITE_LYRICS_TABLE_ID: 'lyrics',
    APPWRITE_PROJECT_ID: 'project',
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: 'http://localhost:5173',
    DB: db,
    GOOGLE_CLIENT_ID: 'x',
    GOOGLE_CLIENT_SECRET: 'x',
    INTERNAL_SECRET: 'internal',
    TRUSTED_ORIGINS: 'http://localhost:5173',
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handlers never call it on these routes
  const ctx = { waitUntil: () => null } as unknown as ExecutionContext
  const call = async (path: string, init: RequestInit = {}) =>
    await worker.fetch(new Request(`http://localhost${path}`, init), env, ctx)
  const listens = async (videoId: string) => {
    const row = await db
      .prepare(`select "listens" from "songStat" where "videoId" = ?1`)
      .bind(videoId)
      .first<{ listens: number }>()
    return row?.listens ?? 0
  }
  // As the app sends them: a guest's listen names its device; a like is the signed-in account's
  const listen = async (videoId: string, device = DEVICE) =>
    await call(`/api/songs/${videoId}/listen`, {
      body: JSON.stringify({ device }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  const like = async (videoId: string, signedIn = true) =>
    await call(`/api/songs/${videoId}/like`, {
      body: JSON.stringify({ liked: true }),
      headers: {
        'content-type': 'application/json',
        ...(signedIn ? { cookie } : {}),
      },
      method: 'PUT',
    })
  return { call, cookie, like, listen, listens }
}

test('a library song counts its listen and like; any other video is refused and leaves nothing', async () => {
  const asked = appwrite('up')
  const { call, like, listen, listens } = await setup()
  const counted = await listen(SONG)
  const liked = await like(SONG)
  expect([counted.status, liked.status]).toEqual([204, 200])
  expect(await liked.json()).toEqual({ liked: true, likes: 1, listens: 1 })
  const refused = await listen(NOT_A_SONG)
  expect([refused.status, await refused.json()]).toEqual([
    404,
    { code: 'not_in_library' },
  ])
  const refusedLike = await like(NOT_A_SONG)
  expect(refusedLike.status).toBe(404)
  expect([await listens(SONG), await listens(NOT_A_SONG)]).toEqual([1, 0])
  const recent = await call('/api/songs/recent')
  expect(await recent.json()).toEqual({ videoIds: [SONG] })
  // Appwrite is asked with the project header, for the row under both id encodings
  expect(asked.every((url) => url.includes('/tables/lyrics/rows?'))).toBe(true)
})

test('while Appwrite is down, listens are refused rather than counted blind', async () => {
  appwrite('down')
  const { listen, listens } = await setup()
  const response = await listen(SONG)
  expect(response.status).toBe(503)
  expect(await listens(SONG)).toBe(0)
})

test('a replayed listen counts once; a listen from neither an account nor a device is refused', async () => {
  appwrite('up')
  const { call, cookie, listen, listens } = await setup()
  const statuses = []
  for (let n = 0; n < 5; n += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one replay after another, as a script would send them
    const response = await listen(SONG)
    statuses.push(response.status)
  }
  const signedIn = await call(`/api/songs/${SONG}/listen`, {
    headers: { cookie },
    method: 'POST',
  })
  const nobody = await call(`/api/songs/${SONG}/listen`, { method: 'POST' })
  expect([...statuses, signedIn.status, nobody.status]).toEqual([
    204, 204, 204, 204, 204, 204, 400,
  ])
  // The device once, the account once
  expect(await listens(SONG)).toBe(2)
})

test("a guest can't like: refused without writing, and the stats count no like", async () => {
  appwrite('up')
  const { call, like } = await setup()
  const refused = await like(SONG, false)
  expect([refused.status, await refused.json()]).toEqual([
    401,
    { code: 'unauthorized' },
  ])
  const stats = await call(`/api/songs/${SONG}/stats?device=${DEVICE}`)
  const body: unknown = await stats.json()
  expect(body).toEqual({ liked: false, likes: 0, listens: 0 })
})

test('a lyrics row is looked up under the current and the pre-migration id', () => {
  expect(lyricsRowIds(SONG)).toEqual([SONG])
  expect(lyricsRowIds('-0-OZND5HY0')).toEqual([
    'yt_h0-OZND5HY0',
    'yt__0_OZND5HY0',
  ])
  expect(lyricsRowIds('_abcdEFGhij')).toEqual([
    'yt_uabcdEFGhij',
    'yt__abcdEFGhij',
  ])
})
