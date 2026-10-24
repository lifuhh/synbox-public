import { afterEach, expect, mock, spyOn, test } from 'bun:test'

import worker from './index'
import {
  LYRICS_FIELDS,
  markColumn,
  readMarks,
  TRACE_CHARS,
  traceMark,
  traceTag,
} from './lyrics'
import { migratedD1, sessionCookie } from './test-d1'

const SONG = '6rG_irmOQsM'
const OTHER = 'EaA6NlH80wg'
const SECRET = 'test-secret-test-secret-test-secret'
const TRACE = 'trace-test-key'

afterEach(() => {
  mock.restore()
})

// Appwrite and the lookup service as the Worker sees them: a row for SONG and OTHER, every column filled
const upstream = () => {
  const asked: { url: string; headers: Headers }[] = []
  // oxlint-disable-next-line eslint/require-await -- fetch's shape; nothing here waits
  const answer = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    asked.push({ headers: new Headers(init?.headers), url })
    if (url.includes('/karaoke/')) {
      return Response.json({ lines: [], version: 2 })
    }
    const decoded = decodeURIComponent(url)
    const rows = [SONG, OTHER]
      .filter((id) => decoded.includes(id))
      .map((id) => ({
        $createdAt: '2026-10-01T00:00:00.000+00:00',
        $id: id,
        $updatedAt: '2026-10-02T00:00:00.000+00:00',
        active_version: 2,
        chi_translation: JSON.stringify(['第一行', '']),
        eng_translation: JSON.stringify(['First line', '']),
        full_lyrics: 'never sent',
        labelled_full_lyrics: '[]',
        plain_lyrics: 'plain',
        romaji: JSON.stringify(['ichi']),
        visit_count: 9,
      }))
    return Response.json({ rows, total: 0 })
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Bun's fetch type adds preconnect, never called here
  spyOn(globalThis, 'fetch').mockImplementation(answer as typeof fetch)
  return asked
}

const setup = async (guestPerHour = '60') => {
  const { db } = migratedD1()
  await db
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values ('me', 'Me', 'me@x', 1, 0, 0)`
    )
    .run()
  const cookie = await sessionCookie(db, SECRET, 'me')
  const env = {
    APPWRITE_API_KEY: 'server-key',
    APPWRITE_DATABASE_ID: 'db',
    APPWRITE_LYRICS_TABLE_ID: 'lyrics',
    APPWRITE_PROJECT_ID: 'project',
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: 'http://localhost:5173',
    DB: db,
    GOOGLE_CLIENT_ID: 'x',
    GOOGLE_CLIENT_SECRET: 'x',
    INTERNAL_SECRET: 'internal',
    LOOKUP_BASE: 'https://lookup.test',
    LOOKUP_KEY: 'lookup-key',
    LYRICS_ACCOUNT_PER_HOUR: '3',
    LYRICS_GUEST_PER_HOUR: guestPerHour,
    TRACE_KEY: TRACE,
    TRUSTED_ORIGINS: 'http://localhost:5173',
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one method the handlers call
  const ctx = { waitUntil: () => null } as unknown as ExecutionContext
  const call = async (path: string, headers: Record<string, string> = {}) =>
    await worker.fetch(
      new Request(`http://localhost${path}`, {
        headers: { 'cf-connecting-ip': '203.0.113.7', ...headers },
      }),
      env,
      ctx
    )
  const statusOf = async (
    path: string,
    headers: Record<string, string> = {}
  ) => {
    const response = await call(path, headers)
    return response.status
  }
  return { call, cookie, statusOf }
}

test('a song is the fields the app reads, no others, with the Worker key', async () => {
  const asked = upstream()
  const { call } = await setup()
  const response = await call(`/api/lyrics/${SONG}`)
  expect(response.status).toBe(200)
  const body: Record<string, unknown> = await response.json()
  expect(Object.keys(body).toSorted()).toEqual(
    ['createdAt', 'updatedAt', 'videoId', ...LYRICS_FIELDS].toSorted()
  )
  expect(body).not.toHaveProperty('full_lyrics')
  expect(asked[0]?.headers.get('X-Appwrite-Key')).toBe('server-key')
})

test('there is no list of lyrics: dates only, and only for named songs', async () => {
  upstream()
  const { call, statusOf } = await setup()
  expect(await statusOf('/api/lyrics')).toBe(404)
  expect(await statusOf('/api/lyrics-dates')).toBe(400)
  const response = await call(`/api/lyrics-dates?ids=${SONG},${OTHER}`)
  const body: { songs: Record<string, unknown>[] } = await response.json()
  expect(new Set(body.songs.map((song) => song.videoId))).toEqual(
    new Set([OTHER, SONG])
  )
  expect(Object.keys(body.songs[0] ?? {}).toSorted()).toEqual([
    'createdAt',
    'updatedAt',
    'videoId',
  ])
})

test('a guest past the hourly songs is refused, a song already opened is not', async () => {
  upstream()
  const { call, statusOf } = await setup('1')
  expect(await statusOf(`/api/lyrics/${SONG}`)).toBe(200)
  expect(await statusOf(`/api/karaoke/${SONG}`)).toBe(200)
  expect(await statusOf(`/api/lyrics/${SONG}`)).toBe(200)
  const refused = await call(`/api/lyrics/${OTHER}`)
  expect(refused.status).toBe(429)
  expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)
  // Another network counts on its own
  expect(
    await statusOf(`/api/lyrics/${OTHER}`, {
      'cf-connecting-ip': '198.51.100.2',
    })
  ).toBe(200)
})

test('an account counts apart from its network', async () => {
  upstream()
  const { cookie, statusOf } = await setup('1')
  expect(await statusOf(`/api/lyrics/${SONG}`)).toBe(200)
  expect(await statusOf(`/api/lyrics/${OTHER}`, { cookie })).toBe(200)
})

test('karaoke timing goes to the lookup service with its key', async () => {
  const asked = upstream()
  const { call, statusOf } = await setup()
  const response = await call(`/api/karaoke/${SONG}?version=3`)
  expect(response.status).toBe(200)
  const lookup = asked.find((ask) => ask.url.includes('/karaoke/'))
  expect(lookup?.url).toBe(`https://lookup.test/karaoke/${SONG}?version=3`)
  expect(lookup?.headers.get('X-Synbox-Lookup-Key')).toBe('lookup-key')
  expect(await statusOf(`/api/karaoke/${SONG}?version=x`)).toBe(400)
})

test("the translations carry the requester's mark, and it reads back", async () => {
  upstream()
  const { call, cookie } = await setup()
  const response = await call(`/api/lyrics/${SONG}`, { cookie })
  const body: Record<string, unknown> = await response.json()
  const eng: unknown = JSON.parse(String(body.eng_translation))
  const romaji: unknown = JSON.parse(String(body.romaji))
  const lines = Array.isArray(eng) ? eng.map(String) : []
  expect(lines[1]).toBe('')
  const line = lines[0] ?? ''
  expect(line.replaceAll(TRACE_CHARS, '')).toBe('First line')
  expect(readMarks(line)).toEqual([await traceTag(TRACE, 'u:me')])
  expect(romaji).toEqual(['ichi'])
})

test('a mark survives a copy of part of a line and a column that is not JSON stays', async () => {
  const tag = await traceTag(TRACE, 'g:abc')
  const marked = markColumn(JSON.stringify(['Hello there']), traceMark(tag))
  const parsed: unknown = JSON.parse(String(marked))
  const line = Array.isArray(parsed) ? String(parsed[0]) : ''
  expect(readMarks(`copied: ${line.slice(0, 40)}`)).toEqual([tag])
  expect(markColumn('not json', traceMark(tag))).toBe('not json')
})
