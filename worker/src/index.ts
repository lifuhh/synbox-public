import { Hono } from 'hono'
import type { Context } from 'hono'

import { createAuth } from './auth'
import type { Env } from './auth'
import { parseEvents, pruneEvents, readUsage, saveEvents } from './events'
import { fixer } from './fixer'
import { generation } from './generation'
import type { GenerationEnv } from './generation'
import { applyOps, parseOps, readLibrary } from './library'
import type { LibraryEnv } from './library-songs'
import { libraryMembership } from './library-songs'
import { lyrics, pruneHits } from './lyrics'
import type { LyricsEnv } from './lyrics'
import { applyPrefOps, parsePrefOps, readPrefs } from './prefs'
import {
  checkGeneration,
  expireStalled,
  finishGeneration,
  getQuota,
  reserveGeneration,
} from './quota'
import type {
  FinishedStatus,
  GenerationKind,
  Limits,
  Owner,
  Reservation,
} from './quota'
import {
  listRecommendations,
  parseRecommendations,
  replaceRecommendations,
} from './recommendations'
import {
  dropReport,
  expireReports,
  listFixes,
  listReports,
  markFixes,
  openReportOf,
  parseDrop,
  parseFixMarks,
  parseReport,
  parseResolution,
  reopenReport,
  reportAllowed,
  resolveReport,
  saveReport,
} from './reports'
import { readSignals } from './signals'
import {
  addListen,
  isVideoId,
  likerOf,
  listListenCounts,
  listRecentListens,
  listenerOf,
  pruneListens,
  readStats,
  setLike,
} from './songs'
import { countValidation, pruneValidations } from './validations'
import type { Counted, ValidationLimits } from './validations'

type AppEnv = Env &
  LibraryEnv &
  LyricsEnv &
  GenerationEnv & {
    USER_DAILY_LIMIT: string
    GUEST_DAILY_LIMIT: string
    GUEST_DAILY_TOTAL: string
    NETWORK_DAILY_LIMIT: string
    VALIDATION_USER_DAILY_LIMIT: string
    VALIDATION_GUEST_DAILY_LIMIT: string
    VALIDATION_NETWORK_DAILY_LIMIT: string
    REPORTS_FIXER_TOKEN?: string
  }

const app = new Hono<{ Bindings: AppEnv }>()

// An unset or unreadable number means no songs, never unlimited
const count = (value: string | undefined) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

const limitsOf = (env: AppEnv): Limits => ({
  guest: count(env.GUEST_DAILY_LIMIT),
  guestTotal: count(env.GUEST_DAILY_TOTAL),
  network: count(env.NETWORK_DAILY_LIMIT),
  user: count(env.USER_DAILY_LIMIT),
})

const validationLimitsOf = (env: AppEnv): ValidationLimits => ({
  guest: count(env.VALIDATION_GUEST_DAILY_LIMIT),
  network: count(env.VALIDATION_NETWORK_DAILY_LIMIT),
  user: count(env.VALIDATION_USER_DAILY_LIMIT),
})

const userIdOf = async (env: AppEnv, headers: Headers) => {
  const session = await createAuth(env).api.getSession({ headers })
  return session?.user.id ?? null
}

app.on(
  ['GET', 'POST'],
  '/api/auth/*',
  async (c) => await createAuth(c.env).handler(c.req.raw)
)

app.get('/api/me', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) {
    return c.json({ user: null })
  }
  const { id, name, email, image, role } = session.user
  return c.json({
    quota: await getQuota(c.env.DB, id, limitsOf(c.env)),
    user: { email, id, image, name, role: role ?? 'user' },
  })
})

// The songs the signed-in user generated, newest first, for their offline lyrics; a guest has none
app.get('/api/me/songs', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) {
    return c.json({ songs: [] })
  }
  const { results } = await c.env.DB.prepare(
    `select "videoId", max(coalesce("finishedAt", "createdAt")) as "generatedAt" from "generation"
     where "userId" = ?1 and "status" = 'succeeded'
     group by "videoId" order by "generatedAt" desc limit 1000`
  )
    .bind(session.user.id)
    .all()
  return c.json({ songs: results })
})

// The signed-in user's history, bookmarks and playlists, so a new device or a reinstalled app starts with them
app.get('/api/me/library', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) {
    return c.json({ code: 'unauthorized' }, 401)
  }
  return c.json(await readLibrary(c.env.DB, session.user.id))
})

// Changes the app made on a device, oldest first; the same ops sent again change nothing
app.post('/api/me/library', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) {
    return c.json({ code: 'unauthorized' }, 401)
  }
  const ops = parseOps(
    await c.req.json<unknown>().catch(() => null),
    Date.now()
  )
  if (ops === null) {
    return c.json({ code: 'bad_request' }, 400)
  }
  // An account past its limits (library.ts › BOOKMARKS_LIMIT and the rest) gets nothing of the batch
  if (!(await applyOps(c.env.DB, session.user.id, ops))) {
    return c.json({ code: 'library_full' }, 413)
  }
  return c.body(null, 204)
})

// The signed-in user's synced settings, so a new device or a reinstalled app looks the way they left it
app.get('/api/me/prefs', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) {
    return c.json({ code: 'unauthorized' }, 401)
  }
  return c.json({ prefs: await readPrefs(c.env.DB, session.user.id) })
})

// Settings changed on a device, oldest first; the same ops sent again change nothing
app.post('/api/me/prefs', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) {
    return c.json({ code: 'unauthorized' }, 401)
  }
  const ops = parsePrefOps(
    await c.req.json<unknown>().catch(() => null),
    Date.now()
  )
  if (ops === null) {
    return c.json({ code: 'bad_request' }, 400)
  }
  // An account past its limits (prefs.ts › PREFS_KEYS_LIMIT, PREFS_SIZE_LIMIT) gets nothing of the batch
  if (!(await applyPrefOps(c.env.DB, session.user.id, ops))) {
    return c.json({ code: 'prefs_full' }, 413)
  }
  return c.body(null, 204)
})

// A signed-in listener's report of something wrong with a song's lyrics, a few a day (reports.ts). A message
// that says nothing is refused as uninformative
app.post('/api/reports', async (c) => {
  const userId = await userIdOf(c.env, c.req.raw.headers)
  if (userId === null) {
    return c.json({ code: 'unauthorized' }, 401)
  }
  const parsed = parseReport(await c.req.json<unknown>().catch(() => null))
  if (!parsed.ok) {
    return c.json({ code: parsed.code }, 400)
  }
  const now = Date.now()
  // One open report per song: every issue goes in it
  if ((await openReportOf(c.env.DB, userId, parsed.report.videoId)) !== null) {
    return c.json({ code: 'already_reported' }, 409)
  }
  if (!(await reportAllowed(c.env.DB, userId, now))) {
    return c.json({ code: 'too_many_reports' }, 429)
  }
  const saved = await saveReport(
    c.env.DB,
    userId,
    parsed.report,
    c.req.header('user-agent') ?? '',
    now
  )
  return saved ? c.body(null, 201) : c.json({ code: 'already_reported' }, 409)
})

// The signed-in user's open report on a song, so Report Issue shows it instead of a form it would refuse
app.get('/api/reports/mine', async (c) => {
  const userId = await userIdOf(c.env, c.req.raw.headers)
  const videoId = c.req.query('videoId') ?? ''
  return c.json({
    report:
      userId === null || !isVideoId(videoId)
        ? null
        : await openReportOf(c.env.DB, userId, videoId),
  })
})

// Songs the signed-in user reported that got new lyrics since, for their notifications; a guest has none
app.get('/api/me/fixes', async (c) => {
  const userId = await userIdOf(c.env, c.req.raw.headers)
  return c.json({
    fixes: userId === null ? [] : await listFixes(c.env.DB, userId),
  })
})

// Fixes the user's notifications showed ({ videoIds, upTo }): seen counts them out of the bell's number on
// every device, dismissed takes them off the list
app.post('/api/me/fixes/:mark{seen|dismiss}', async (c) => {
  const userId = await userIdOf(c.env, c.req.raw.headers)
  if (userId === null) {
    return c.json({ code: 'unauthorized' }, 401)
  }
  const marks = parseFixMarks(await c.req.json<unknown>().catch(() => null))
  if (marks === null) {
    return c.json({ code: 'bad_request' }, 400)
  }
  await markFixes(
    c.env.DB,
    userId,
    marks,
    c.req.param('mark') === 'seen' ? 'seen' : 'dismissed',
    Date.now()
  )
  return c.body(null, 204)
})

// Listens and likes are kept for library songs only (library-songs.ts): a video that isn't one is refused,
// and so is any song while the library can't be asked
const refusedSong = async (env: AppEnv, videoId: string) => {
  const membership = await libraryMembership(env, videoId)
  if (membership === 'in') {
    return null
  }
  return membership === 'out'
    ? ({ body: { code: 'not_in_library' }, status: 404 } as const)
    : ({ body: { code: 'library_unavailable' }, status: 503 } as const)
}

// A visit to a song's player page ({ device } for a guest): one more listen, once an hour per account or device
// (songs.ts › addListen). A listen that doesn't count still answers 204
app.post('/api/songs/:videoId/listen', async (c) => {
  const videoId = c.req.param('videoId')
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  const device = typeof body?.device === 'string' ? body.device : null
  const listener = listenerOf(await userIdOf(c.env, c.req.raw.headers), device)
  if (!isVideoId(videoId) || listener === null) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const refused = await refusedSong(c.env, videoId)
  if (refused !== null) {
    return c.json(refused.body, refused.status)
  }
  await addListen(c.env.DB, videoId, listener, Date.now())
  return c.body(null, 204)
})

// Usage events from the app (events.ts), batched: an account's, or a guest's with { device }. Whatever is
// unknown, malformed or past the daily cap is dropped; the answer is 204 either way, so the app never retries
app.post('/api/events', async (c) => {
  const now = Date.now()
  // MAX_BATCH events with their props fit well within this
  if (Number(c.req.header('content-length') ?? 0) > 16_384) {
    return c.json({ code: 'too_large' }, 413)
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  const device = typeof body?.device === 'string' ? body.device : null
  const events = parseEvents(body, now)
  if (events === null) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const actor = listenerOf(await userIdOf(c.env, c.req.raw.headers), device)
  if (actor !== null && events.length > 0) {
    await saveEvents(c.env.DB, actor, events, now)
  }
  return c.body(null, 204)
})

// The songs anyone played most recently, latest first. Public; browsers keep it a minute
app.get('/api/songs/recent', async (c) => {
  c.header('Cache-Control', 'public, max-age=60')
  return c.json({ videoIds: await listRecentListens(c.env.DB) })
})

// The counts on song cards: { videoId: listens } for every song past the cards' threshold. Public; browsers keep
// it five minutes
app.get('/api/songs/listens', async (c) => {
  c.header('Cache-Control', 'public, max-age=300')
  return c.json({ listens: await listListenCounts(c.env.DB) })
})

// A song's listens and likes, and whether this account likes it
app.get('/api/songs/:videoId/stats', async (c) => {
  const videoId = c.req.param('videoId')
  if (!isVideoId(videoId)) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const userId = await userIdOf(c.env, c.req.raw.headers)
  return c.json(
    await readStats(c.env.DB, videoId, userId === null ? null : likerOf(userId))
  )
})

// Like or unlike a song: { liked }; answers with the song's stats after. Likes are for accounts: a guest's press
// signs in instead (src/components/lyrics-display/player-rail.tsx › useLikeAction)
app.put('/api/songs/:videoId/like', async (c) => {
  const userId = await userIdOf(c.env, c.req.raw.headers)
  if (userId === null) {
    return c.json({ code: 'unauthorized' }, 401)
  }
  const videoId = c.req.param('videoId')
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  const liker = likerOf(userId)
  if (!isVideoId(videoId) || typeof body?.liked !== 'boolean') {
    return c.json({ code: 'bad_request' }, 400)
  }
  const refused = await refusedSong(c.env, videoId)
  if (refused !== null) {
    return c.json(refused.body, refused.status)
  }
  await setLike(c.env.DB, videoId, liker, body.liked, Date.now())
  return c.json(await readStats(c.env.DB, videoId, liker))
})

// The landing page's Recommendations, in order. Public; browsers keep it a minute, so an admin's edit shows
// within one
app.get('/api/recommendations', async (c) => {
  c.header('Cache-Control', 'public, max-age=60')
  return c.json({ songs: await listRecommendations(c.env.DB) })
})

// Called only by the Cloud Run backend, after it has verified the user's JWT or hashed the guest's address
const internal = new Hono<{ Bindings: AppEnv }>()

internal.use(async (c, next) => {
  const given = new TextEncoder().encode(c.req.header('Authorization') ?? '')
  const expected = new TextEncoder().encode(`Bearer ${c.env.INTERNAL_SECRET}`)
  if (
    c.env.INTERNAL_SECRET === '' ||
    given.length !== expected.length ||
    !crypto.subtle.timingSafeEqual(given, expected)
  ) {
    return c.json({ code: 'forbidden' }, 403)
  }
  // oxlint-disable-next-line node/callback-return -- Hono's next() runs the route, which sets c.res
  await next()
  return c.res
})

const KINDS = new Set<string>(['new', 'regenerate', 'retime'])
const STATUSES = new Set<string>(['running', 'succeeded', 'failed'])

const isText = (value: unknown, max = 64): value is string =>
  typeof value === 'string' && value !== '' && value.length <= max

const isKind = (value: unknown): value is GenerationKind =>
  typeof value === 'string' && KINDS.has(value)

const isStatus = (value: unknown): value is FinishedStatus =>
  typeof value === 'string' && STATUSES.has(value)

const RESERVATION_STATUS = {
  allowed: 200,
  already_finished: 409,
  forbidden: 403,
  generation_paused: 503,
  guest_limit: 429,
  guests_full: 429,
  network_limit: 429,
  quota_exceeded: 429,
  replay: 200,
  reserved: 201,
} as const

// Exactly one of userId and guestKey
const ownerOf = ({
  userId,
  guestKey,
}: Record<string, unknown>): Owner | null => {
  if (isText(userId) && guestKey === undefined) {
    return { id: userId, kind: 'user' }
  }
  if (isText(guestKey) && userId === undefined) {
    return { key: guestKey, kind: 'guest' }
  }
  return null
}

// Where the request came from, as the backend saw it; either may be missing (an older backend)
const originOf = ({ networkKey, client }: Record<string, unknown>) => ({
  client: typeof client === 'string' ? client.slice(0, 256) : null,
  network: isText(networkKey) ? networkKey : null,
})

const answer = (c: Context, reservation: Reservation) => {
  const status = RESERVATION_STATUS[reservation.outcome]
  return reservation.outcome === 'reserved' ||
    reservation.outcome === 'replay' ||
    reservation.outcome === 'allowed'
    ? c.json(reservation, status)
    : c.json({ ...reservation, code: reservation.outcome }, status)
}

internal.post('/generations', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const { id, videoId, kind } = body
  const owner = ownerOf(body)
  if (!isText(id) || owner === null || !isText(videoId) || !isKind(kind)) {
    return c.json({ code: 'bad_request' }, 400)
  }
  return answer(
    c,
    await reserveGeneration(
      c.env.DB,
      { id, kind, owner, videoId, ...originOf(body) },
      limitsOf(c.env)
    )
  )
})

// Same answer as reserving, without taking a song
internal.post('/generations/check', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const { videoId, kind } = body
  const owner = ownerOf(body)
  if (owner === null || !isText(videoId) || !isKind(kind)) {
    return c.json({ code: 'bad_request' }, 400)
  }
  return answer(
    c,
    await checkGeneration(
      c.env.DB,
      { kind, owner, videoId, ...originOf(body) },
      limitsOf(c.env)
    )
  )
})

internal.patch('/generations/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const { status, resultVersion, errorCode, stage, fraction } = body
  if (!isStatus(status)) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const updated = await finishGeneration(c.env.DB, c.req.param('id'), {
    errorCode: isText(errorCode, 200) ? errorCode : undefined,
    fraction:
      typeof fraction === 'number' && fraction >= 0 && fraction <= 1
        ? fraction
        : undefined,
    resultVersion:
      typeof resultVersion === 'number' ? resultVersion : undefined,
    stage: isText(stage, 80) ? stage : undefined,
    status,
  })
  return updated ? c.body(null, 204) : c.json({ code: 'not_found' }, 404)
})

const COUNTED_STATUS: Record<Counted['outcome'], 200 | 201 | 403 | 429> = {
  counted: 201,
  forbidden: 403,
  replay: 200,
  validation_limit: 429,
}

// One song check (the backend's /validate, which downloads the song), counted against the caller's and the
// network's caps; the id makes asking again after a dropped connection count once
internal.post('/validations', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const { id, videoId } = body
  const owner = ownerOf(body)
  if (
    !isText(id) ||
    owner === null ||
    !isText(videoId) ||
    !isVideoId(videoId)
  ) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const counted = await countValidation(
    c.env.DB,
    { id, owner, videoId, ...originOf(body) },
    limitsOf(c.env),
    validationLimitsOf(c.env)
  )
  const status = COUNTED_STATUS[counted.outcome]
  return status < 400
    ? c.json(counted, status)
    : c.json({ ...counted, code: counted.outcome }, status)
})

app.route('/internal', internal)

app.route('/api/fixer', fixer)

// The app's song generation calls, passed on to the generating service (generation.ts)
app.route('/api/generation', generation)

// Lyrics and karaoke timing, one song at a time, counted per requester (lyrics.ts)
app.route('/api', lyrics)

// The admin pane (src/_root/pages/admin-page.tsx). Every route checks the session's role on the server
const admin = new Hono<{ Bindings: AppEnv; Variables: { adminId: string } }>()

admin.use(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })
  if (session?.user.role !== 'admin') {
    return c.json({ code: 'forbidden' }, 403)
  }
  c.set('adminId', session.user.id)
  // oxlint-disable-next-line node/callback-return -- Hono's next() runs the route, which sets c.res
  await next()
  return c.res
})

// Everyone who has signed in, most recently seen first, with their songs in the last 24 hours and overall
admin.get('/users', async (c) => {
  await expireStalled(c.env.DB)
  const since = Date.now() - 86_400_000
  const { results } = await c.env.DB.prepare(
    `select u."id", u."email", u."name", u."image", u."role", u."banned", u."banReason", u."createdAt",
       (select max(s."updatedAt") from "session" s where s."userId" = u."id") as "lastSeenAt",
       case when q."userId" is null then 'default' when q."dailyLimit" is null then 'unlimited'
         else q."dailyLimit" end as "dailyLimit",
       (select count(*) from "generation" g where g."userId" = u."id" and g."createdAt" > ?1
          and g."status" <> 'failed') as "songsLastDay",
       (select count(*) from "generation" g where g."userId" = u."id" and g."status" = 'succeeded')
          as "songsTotal"
     from "user" u left join "quotaOverride" q on q."userId" = u."id"
     order by "lastSeenAt" desc nulls last, u."createdAt" desc`
  )
    .bind(since)
    .all()
  return c.json({ users: results })
})

// The latest generations, newest first, with who asked for them (an account, or a guest). `user` narrows them
// to one account (its email) or to guests ('guest'). The where clause is one of three literals, never input
admin.get('/generations', async (c) => {
  await expireStalled(c.env.DB)
  const user = c.req.query('user') ?? ''
  let where = ''
  if (user === 'guest') {
    where = 'where g."guestKey" is not null'
  } else if (user !== '') {
    where = 'where u."email" = ?1'
  }
  const statement = c.env.DB.prepare(
    `select g."id", g."videoId", g."kind", g."status", g."createdAt", g."errorCode", g."resultVersion",
       g."stage", g."fraction", u."email", u."name", g."guestKey" is not null as "guest"
     from "generation" g left join "user" u on u."id" = g."userId"
     ${where}
     order by g."createdAt" desc limit 200`
  )
  const { results } = await (
    where.includes('?1') ? statement.bind(user) : statement
  ).all()
  return c.json({ generations: results })
})

// A per-person daily limit: a number, 'unlimited', or 'default' to go back to USER_DAILY_LIMIT
admin.put('/users/:id/limit', async (c) => {
  const { dailyLimit } = await c.req.json<Record<string, unknown>>()
  const id = c.req.param('id')
  if (dailyLimit === 'default') {
    await c.env.DB.prepare(`delete from "quotaOverride" where "userId" = ?1`)
      .bind(id)
      .run()
    return c.body(null, 204)
  }
  if (
    dailyLimit !== 'unlimited' &&
    (typeof dailyLimit !== 'number' ||
      !Number.isInteger(dailyLimit) ||
      dailyLimit < 0)
  ) {
    return c.json({ code: 'bad_request' }, 400)
  }
  await c.env.DB.prepare(
    `insert into "quotaOverride" ("userId", "dailyLimit", "setBy", "setAt") values (?1, ?2, ?3, ?4)
     on conflict ("userId") do update set "dailyLimit" = ?2, "setBy" = ?3, "setAt" = ?4`
  )
    .bind(
      id,
      dailyLimit === 'unlimited' ? null : dailyLimit,
      c.get('adminId'),
      Date.now()
    )
    .run()
  return c.body(null, 204)
})

// The limits in force, today's guest songs, and the switch that pauses all generation
admin.get('/settings', async (c) => {
  const limits = limitsOf(c.env)
  const enabled = await c.env.DB.prepare(
    `select "value" from "appSetting" where "key" = 'generationEnabled'`
  ).first<string>('value')
  const guestSongsToday = await c.env.DB.prepare(
    `select count(*) from "generation" where "guestKey" is not null and "utcDay" = ?1 and "status" <> 'failed'`
  )
    .bind(new Date().toISOString().slice(0, 10))
    .first<number>('count(*)')
  return c.json({
    generationEnabled: enabled === '1',
    guestSongsToday: guestSongsToday ?? 0,
    limits,
  })
})

admin.put('/settings', async (c) => {
  const { generationEnabled } = await c.req.json<Record<string, unknown>>()
  if (typeof generationEnabled !== 'boolean') {
    return c.json({ code: 'bad_request' }, 400)
  }
  await c.env.DB.prepare(
    `update "appSetting" set "value" = ?1 where "key" = 'generationEnabled'`
  )
    .bind(generationEnabled ? '1' : '0')
    .run()
  return c.body(null, 204)
})

// The whole list, in the order to show; it replaces the current one
admin.put('/recommendations', async (c) => {
  const body = await c.req.json<unknown>().catch(() => null)
  const parsed = parseRecommendations(body)
  if (!parsed.ok) {
    return c.json({ code: parsed.code }, 400)
  }
  await replaceRecommendations(c.env.DB, parsed.songs, c.get('adminId'))
  return c.body(null, 204)
})

// The latest listener reports, for fixing the lyrics they point at
admin.get('/reports', async (c) =>
  c.json({ reports: await listReports(c.env.DB) })
)

// Marks a report dealt with; the body ({ version?, note? }) may be empty. Resolving again replaces the details
admin.post('/reports/:id/resolve', async (c) => {
  const resolution = parseResolution(
    await c.req.json<unknown>().catch(() => ({}))
  )
  if (resolution === null) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const found = await resolveReport(
    c.env.DB,
    c.req.param('id'),
    resolution,
    Date.now()
  )
  return found ? c.body(null, 204) : c.json({ code: 'not_found' }, 404)
})

// Closes a report without a fix ({ reason, note? }); its reporter is never told. Reopen undoes it
admin.post('/reports/:id/drop', async (c) => {
  const drop = parseDrop(await c.req.json<unknown>().catch(() => null))
  if (drop === null) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const found = await dropReport(c.env.DB, c.req.param('id'), drop, Date.now())
  return found ? c.body(null, 204) : c.json({ code: 'not_found' }, 404)
})

// Refused while its reporter has a newer open report on the song (one open per song)
admin.post('/reports/:id/reopen', async (c) => {
  const result = await reopenReport(c.env.DB, c.req.param('id'))
  if (result === 'reopened') {
    return c.body(null, 204)
  }
  return result === 'conflict'
    ? c.json({ code: 'already_open' }, 409)
    : c.json({ code: 'not_found' }, 404)
})

// How the app is used: active people a day and a week, each event's count, the most listened songs (events.ts)
admin.get('/usage', async (c) => c.json(await readUsage(c.env.DB, Date.now())))

// Leads on someone working around the song limit (worker/src/signals.ts)
admin.get('/signals', async (c) =>
  c.json(await readSignals(c.env.DB, limitsOf(c.env).user))
)

app.route('/api/admin', admin)

export default {
  fetch: app.fetch,
  // The daily cron (wrangler.jsonc): reports the fixer left open past EXPIRE_DAYS are dropped as expired, and
  // listen rows past their hour, song checks past their 24 hours, lyrics hits past their 30 days and usage events
  // past their 90 go
  scheduled: (_controller, env, ctx) => {
    const now = Date.now()
    ctx.waitUntil(expireReports(env.DB, now))
    ctx.waitUntil(pruneListens(env.DB, now))
    ctx.waitUntil(pruneValidations(env.DB, now))
    ctx.waitUntil(pruneHits(env.DB, now))
    ctx.waitUntil(pruneEvents(env.DB, now))
  },
} satisfies ExportedHandler<AppEnv>
