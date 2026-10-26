import { Hono } from 'hono'
import type { Context } from 'hono'

import { createAuth } from './auth'
import type { Env } from './auth'
import type { LibraryEnv } from './library-songs'
import { lyricsRowIds } from './library-songs'
import { isVideoId } from './songs'

// The app's lyrics and karaoke timing, one song at a time, through the Worker: the lyrics row from Appwrite with the
// Worker's own key, the timing from the backend's lookup service with the key it shares with the Worker. Each
// requester (an account, or a guest's network for the day) may open so many songs an hour; a song already opened
// this hour is free again. The translations carry an invisible mark of who asked (traceMark), so a copied text can
// be traced back (scripts/trace-decode.ts)

export interface LyricsEnv extends Env, LibraryEnv {
  // A server key with read access to the lyrics table (Appwrite console › API keys, scope rows.read)
  APPWRITE_API_KEY?: string
  // The backend's lookup service, and the key it checks on lyric reads (synbox-transcribe-whisper)
  LOOKUP_BASE?: string
  LOOKUP_KEY?: string
  // Signs the translations' invisible mark and the guests' network keys
  TRACE_KEY?: string
  LYRICS_GUEST_PER_HOUR?: string
  LYRICS_NETWORK_PER_HOUR?: string
  LYRICS_ACCOUNT_PER_HOUR?: string
}

// What the app reads of a lyrics row (src/lib/lyrics-document.ts, the player's plain text check, the report form's
// version); the row's other columns (the unlabelled text, counters) never leave the Worker
export const LYRICS_FIELDS = [
  'labelled_full_lyrics',
  'romaji',
  'eng_translation',
  'chi_translation',
  'plain_lyrics',
  'active_version',
] as const
const TRACED_FIELDS = ['eng_translation', 'chi_translation'] as const

// A guest browser: a song a minute keeps playing a queue and saving the last 30 songs for offline reading in reach. Its
// network (an office, a carrier's shared address) gets five browsers' worth, a backstop against a browser id made up
// per request. An account: more than a listener opens in an hour
const GUEST_PER_HOUR = 60
const NETWORK_PER_HOUR = 300
const ACCOUNT_PER_HOUR = 300
const HOUR = 3_600_000
const KEEP_HITS_DAYS = 30
// A lyrics row or timing changes only on a fix or a new version; two minutes at the edge saves Appwrite and the
// lookup service from repeat reads, and a fixer's new version shows within them
const CACHE_SECONDS = 120
const DATES_MAX = 50

// The app's pages: the site, its deploy previews (the release smoke-tests one before merging) and local servers, as
// worker/src/generation.ts allows
const APP_ORIGIN =
  /^(?:https:\/\/(?:(?:www\.)?synbox\.io|(?:[a-z0-9-]+--)?synbox\.netlify\.app)|http:\/\/localhost:\d+)$/u

const perHour = (value: string | undefined, fallback: number) => {
  const n = Number(value)
  return value !== undefined && Number.isInteger(n) && n > 0 ? n : fallback
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

export const hmac = async (secret: string, text: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  )
  return hex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  )
}

// The mark: 24 bits of the requester's HMAC, as default-ignorable characters that draw nothing and never break a
// line, framed by word joiners. Written after a line's first character, so a part copied from its start keeps it
const FRAME = String.fromCodePoint(0x20_60)
const ZERO = String.fromCodePoint(0x20_62)
const ONE = String.fromCodePoint(0x20_63)
export const TRACE_CHARS = new RegExp(`[${FRAME}${ZERO}${ONE}]`, 'gu')
const MARK = new RegExp(`${FRAME}(?<bits>[${ZERO}${ONE}]{24})${FRAME}`, 'gu')

export const traceTag = async (secret: string, requester: string) => {
  const mac = await hmac(secret, `trace:${requester}`)
  return mac.slice(0, 6)
}

export const traceMark = (tag: string) =>
  FRAME +
  Number.parseInt(tag, 16)
    .toString(2)
    .padStart(24, '0')
    .split('')
    .map((bit) => (bit === '1' ? ONE : ZERO))
    .join('') +
  FRAME

// Every mark in a text, as tags
export const readMarks = (text: string) =>
  [...text.matchAll(MARK)].map((match) =>
    Number.parseInt(
      (match.groups?.bits ?? '')
        .split('')
        .map((char) => (char === ONE ? '1' : '0'))
        .join(''),
      2
    )
      .toString(16)
      .padStart(6, '0')
  )

const graphemes = new Intl.Segmenter()
const markLine = (line: string, mark: string) => {
  const first = graphemes.segment(line)[Symbol.iterator]().next().value?.segment
  return first === undefined || line.trim() === ''
    ? line
    : `${first}${mark}${line.slice(first.length)}`
}

// Every MARK_EVERY-th line with text, from the first: a copy of a whole song carries the mark many times over,
// and the answer stays small
const MARK_EVERY = 3
const markEvery = (lines: unknown[], mark: string) => {
  let withText = 0
  return lines.map((line) => {
    if (typeof line !== 'string' || line.trim() === '') {
      return line
    }
    withText += 1
    return (withText - 1) % MARK_EVERY === 0 ? markLine(line, mark) : line
  })
}

// A translation column is a JSON array of lines in a string; a column that isn't one passes unmarked
export const markColumn = (column: unknown, mark: string) => {
  if (typeof column !== 'string') {
    return column
  }
  try {
    const lines: unknown = JSON.parse(column)
    return Array.isArray(lines)
      ? JSON.stringify(markEvery(lines, mark))
      : column
  } catch {
    return column
  }
}

type Ctx = Context<{ Bindings: LyricsEnv }>

const corsOf = (c: Ctx): Record<string, string> => {
  const origin = c.req.header('origin') ?? ''
  return APP_ORIGIN.test(origin)
    ? {
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
      }
    : {}
}

// One hourly budget: whose songs are counted, and how many new ones an hour
interface Budget {
  key: string
  limit: number
}

// A guest's browser id: the random one the app keeps for listens (src/lib/song-stats.ts › deviceId)
const DEVICE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u

const accountOf = async (c: Ctx): Promise<string | null> => {
  const auth = createAuth(c.env)
  const bearer = /^Bearer (?<token>.+)$/u.exec(
    c.req.header('authorization') ?? ''
  )?.groups?.token
  if (bearer !== undefined) {
    try {
      const verified = await auth.api.verifyJWT({ body: { token: bearer } })
      if (verified.payload?.sub !== undefined) {
        return verified.payload.sub
      }
    } catch {
      // An expired or foreign token counts as no account
    }
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  return session?.user.id ?? null
}

// Who is asking and what they may open: an account (a session cookie through the app's own origin, or the backend
// token the app sends cross-origin) on its own budget; a guest browser on its own, and on its network's backstop;
// a guest without a browser id (storage blocked, or a script) on its network at a browser's rate. Networks and
// browsers are kept only as HMACs. `mark` names who the translations' mark points to
export const requesterOf = async (
  c: Ctx
): Promise<{ mark: string; budgets: Budget[] }> => {
  const { env } = c
  const account = await accountOf(c)
  if (account !== null) {
    const key = `u:${account}`
    return {
      budgets: [
        { key, limit: perHour(env.LYRICS_ACCOUNT_PER_HOUR, ACCOUNT_PER_HOUR) },
      ],
      mark: key,
    }
  }
  const secret = env.TRACE_KEY ?? env.BETTER_AUTH_SECRET
  const address = c.req.header('cf-connecting-ip') ?? 'unknown'
  const day = Math.floor(Date.now() / (24 * HOUR))
  const networkMac = await hmac(secret, `net:${address}:${day}`)
  const network = networkMac.slice(0, 16)
  const guestLimit = perHour(env.LYRICS_GUEST_PER_HOUR, GUEST_PER_HOUR)
  const device = c.req.header('x-synbox-device') ?? ''
  if (!DEVICE.test(device)) {
    const key = `n:${network}`
    return { budgets: [{ key, limit: guestLimit }], mark: key }
  }
  const browser = await hmac(secret, `device:${device}`)
  const key = `d:${browser.slice(0, 16)}`
  return {
    budgets: [
      { key, limit: guestLimit },
      {
        key: `g:${network}`,
        limit: perHour(env.LYRICS_NETWORK_PER_HOUR, NETWORK_PER_HOUR),
      },
    ],
    mark: key,
  }
}

interface BudgetNow {
  requester: string
  n: number
  seen: number
}

// One read for all of a request's budgets (a second round trip to the database per request was most of a song's
// wait): how many songs each counts this hour, and whether it already counts this one
const budgetsNow = async (
  db: D1Database,
  budgets: Budget[],
  videoId: string,
  hour: number
) => {
  const keys = budgets.map(({ key }) => key)
  const listed = keys.map((_, index) => `?${index + 3}`).join(', ')
  const { results } = await db
    .prepare(
      `select "requester", count(*) as "n", max("videoId" = ?1) as "seen" from "lyrics_hit" where "hour" = ?2 and "requester" in (${listed}) group by "requester"`
    )
    .bind(videoId, hour, ...keys)
    .all<BudgetNow>()
  return new Map(results.map((row) => [row.requester, row]))
}

// Counts a song against every budget of the requester's hour; a song already counted in a budget is free there. The
// seconds to wait when any budget is spent (nothing is counted then), or null when it may be read. The count is
// written by `defer` (the Worker's waitUntil), after the answer: two requests landing in the same instant may both
// fit a budget with one place left, which an hourly budget can afford
export const takeSong = async (
  db: D1Database,
  budgets: Budget[],
  videoId: string,
  now: number,
  defer: (work: Promise<unknown>) => void
): Promise<number | null> => {
  const hour = Math.floor(now / HOUR)
  const counts = await budgetsNow(db, budgets, videoId, hour)
  const spent = budgets.some(({ key, limit }) => {
    const row = counts.get(key)
    return row?.seen !== 1 && (row?.n ?? 0) >= limit
  })
  if (spent) {
    return Math.max(1, Math.ceil(((hour + 1) * HOUR - now) / 1000))
  }
  defer(
    db.batch(
      budgets.map(({ key }) =>
        db
          .prepare(
            `insert or ignore into "lyrics_hit" ("requester", "hour", "videoId") values (?1, ?2, ?3)`
          )
          .bind(key, hour, videoId)
      )
    )
  )
  return null
}

// Hits are kept KEEP_HITS_DAYS: they say which requesters a traced copy can come from
export const pruneHits = async (db: D1Database, now: number) => {
  await db
    .prepare(`delete from "lyrics_hit" where "hour" < ?1`)
    .bind(Math.floor((now - KEEP_HITS_DAYS * 24 * HOUR) / HOUR))
    .run()
}

const cached = async (
  key: string,
  load: () => Promise<Response>
): Promise<Response> => {
  const cache = 'caches' in globalThis ? caches.default : undefined
  const request = new Request(`https://api.synbox.io/__lyrics/${key}`)
  const hit = await cache?.match(request)
  if (hit !== undefined) {
    return hit
  }
  const response = await load()
  // Only a found row or timing is kept. A miss is never kept: a song being generated is missing until it saves,
  // and a short song saves within the two minutes a kept miss would last (lP9KB4rJw68, 2026-10-27: generated in
  // 81 s, then "Not on Synbox Yet" on Play and on every refresh)
  if (response.ok) {
    const stored = new Response(await response.clone().arrayBuffer(), {
      headers: {
        'Cache-Control': `max-age=${CACHE_SECONDS}`,
        'Content-Type':
          response.headers.get('content-type') ?? 'application/json',
      },
      status: response.status,
    })
    await cache?.put(request, stored)
  }
  return response
}

const appwriteRows = async (
  env: LyricsEnv,
  videoIds: string[],
  fields: readonly string[]
): Promise<Record<string, unknown>[] | null> => {
  const {
    APPWRITE_URL: url = 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_ID: project = '',
    APPWRITE_DATABASE_ID: database = '',
    APPWRITE_LYRICS_TABLE_ID: table = '',
    APPWRITE_API_KEY: key = '',
  } = env
  if (project === '' || database === '' || table === '') {
    console.error('lyrics: Appwrite settings missing')
    return null
  }
  const rowIds = videoIds.flatMap(lyricsRowIds)
  const queries = [
    { attribute: '$id', method: 'equal', values: rowIds },
    {
      method: 'select',
      values: ['$id', '$createdAt', '$updatedAt', ...fields],
    },
    { method: 'limit', values: [rowIds.length] },
  ]
    .map((query) => `queries[]=${encodeURIComponent(JSON.stringify(query))}`)
    .join('&')
  const headers: Record<string, string> = { 'X-Appwrite-Project': project }
  if (key !== '') {
    headers['X-Appwrite-Key'] = key
  }
  const response = await fetch(
    `${url}/tablesdb/${database}/tables/${table}/rows?${queries}&total=false`,
    { headers }
  )
  if (!response.ok) {
    console.error(`lyrics: Appwrite answered ${response.status}`)
    return null
  }
  const body: { rows?: unknown } = await response.json()
  return Array.isArray(body.rows)
    ? body.rows.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null
      )
    : []
}

// The row of each video, the current id encoding winning over the old one (src/lib/appwrite/api.ts)
const rowsByVideo = (videoIds: string[], rows: Record<string, unknown>[]) => {
  const found = new Map<string, Record<string, unknown>>()
  for (const videoId of videoIds) {
    const [current, legacy] = lyricsRowIds(videoId)
    const row =
      rows.find((r) => r.$id === current) ?? rows.find((r) => r.$id === legacy)
    if (row !== undefined) {
      found.set(videoId, row)
    }
  }
  return found
}

const datesOf = (row: Record<string, unknown>) => ({
  createdAt:
    typeof row.$createdAt === 'string' ? Date.parse(row.$createdAt) : 0,
  updatedAt:
    typeof row.$updatedAt === 'string' ? Date.parse(row.$updatedAt) : 0,
})

export const lyrics = new Hono<{ Bindings: LyricsEnv }>()

const preflight = (c: Ctx) => {
  const cors = corsOf(c)
  if (cors['Access-Control-Allow-Origin'] === undefined) {
    return c.body(null, 403)
  }
  return c.body(null, 204, {
    ...cors,
    'Access-Control-Allow-Headers': 'Authorization, X-Synbox-Device',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Max-Age': '600',
  })
}
lyrics.options('/lyrics/:videoId', preflight)
lyrics.options('/lyrics-dates', preflight)
lyrics.options('/karaoke/:videoId', preflight)

// The dates of up to DATES_MAX songs' lyrics, no text: what the offline copy checks before fetching a song again
lyrics.get('/lyrics-dates', async (c) => {
  const cors = corsOf(c)
  const ids = (c.req.query('ids') ?? '').split(',').filter((id) => id !== '')
  if (ids.length === 0 || ids.length > DATES_MAX || !ids.every(isVideoId)) {
    return c.json({ code: 'bad_request' }, 400, cors)
  }
  const rows = await appwriteRows(c.env, ids, [])
  if (rows === null) {
    return c.json({ code: 'unavailable' }, 503, cors)
  }
  const songs = [...rowsByVideo(ids, rows)].map(([videoId, row]) => ({
    videoId,
    ...datesOf(row),
  }))
  return c.json({ songs }, 200, cors)
})

// Counts the song before anything is read, cached or not: the 429, or whom the mark names
const admit = async (c: Ctx, videoId: string) => {
  const { mark, budgets } = await requesterOf(c)
  const wait = await takeSong(
    c.env.DB,
    budgets,
    videoId,
    Date.now(),
    (work) => {
      c.executionCtx.waitUntil(work)
    }
  )
  return { requester: mark, wait }
}

const tooMany = (c: Ctx, wait: number) =>
  c.json({ code: 'rate_limited' }, 429, {
    ...corsOf(c),
    'Retry-After': String(wait),
  })

lyrics.get('/lyrics/:videoId', async (c) => {
  const cors = corsOf(c)
  const videoId = c.req.param('videoId')
  if (!isVideoId(videoId)) {
    return c.json({ code: 'bad_request' }, 400, cors)
  }
  const { requester, wait } = await admit(c, videoId)
  if (wait !== null) {
    return tooMany(c, wait)
  }
  const response = await cached(`lyrics/${videoId}`, async () => {
    const rows = await appwriteRows(c.env, [videoId], LYRICS_FIELDS)
    if (rows === null) {
      return Response.json({ code: 'unavailable' }, { status: 503 })
    }
    const row = rowsByVideo([videoId], rows).get(videoId)
    if (row === undefined) {
      return Response.json({ code: 'not_found' }, { status: 404 })
    }
    const body: Record<string, unknown> = { videoId, ...datesOf(row) }
    for (const field of LYRICS_FIELDS) {
      body[field] = row[field] ?? null
    }
    return Response.json(body)
  })
  if (!response.ok) {
    return c.json(await response.json(), response.status === 404 ? 404 : 503, {
      ...cors,
      'Cache-Control': 'no-store',
    })
  }
  const body: Record<string, unknown> = await response.json()
  const secret = c.env.TRACE_KEY ?? ''
  if (secret !== '') {
    const mark = traceMark(await traceTag(secret, requester))
    for (const field of TRACED_FIELDS) {
      body[field] = markColumn(body[field], mark)
    }
  }
  return c.json(body, 200, { ...cors, 'Cache-Control': 'private, no-store' })
})

lyrics.get('/karaoke/:videoId', async (c) => {
  const cors = corsOf(c)
  const videoId = c.req.param('videoId')
  const version = c.req.query('version')
  if (
    !isVideoId(videoId) ||
    (version !== undefined && !/^\d{1,6}$/u.test(version))
  ) {
    return c.json({ code: 'bad_request' }, 400, cors)
  }
  const { LOOKUP_BASE: base = '', LOOKUP_KEY: key = '' } = c.env
  if (base === '') {
    return c.json({ code: 'unavailable' }, 503, cors)
  }
  const { wait } = await admit(c, videoId)
  if (wait !== null) {
    return tooMany(c, wait)
  }
  const query = version === undefined ? '' : `?version=${version}`
  const response = await cached(
    `karaoke/${videoId}/${version ?? 'live'}`,
    async () => {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (key !== '') {
        headers['X-Synbox-Lookup-Key'] = key
      }
      try {
        return await fetch(
          `${base}/karaoke/${encodeURIComponent(videoId)}${query}`,
          { headers }
        )
      } catch {
        return Response.json({ code: 'unreachable' }, { status: 502 })
      }
    }
  )
  if (response.status === 404) {
    return c.json({ code: 'not_found' }, 404, {
      ...cors,
      'Cache-Control': 'no-store',
    })
  }
  if (!response.ok) {
    return c.json({ code: 'unavailable' }, 502, cors)
  }
  return new Response(response.body, {
    headers: {
      ...cors,
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/json',
    },
  })
})
