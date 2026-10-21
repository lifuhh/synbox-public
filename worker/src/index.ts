import { Hono } from 'hono'
import type { Context } from 'hono'

import { createAuth } from './auth'
import type { Env } from './auth'
import {
  checkGeneration,
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

type AppEnv = Env & {
  USER_HOURLY_LIMIT: string
  GUEST_DAILY_LIMIT: string
  GUEST_DAILY_TOTAL: string
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
  user: count(env.USER_HOURLY_LIMIT),
})

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
      { id, kind, owner, videoId },
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
    await checkGeneration(c.env.DB, { kind, owner, videoId }, limitsOf(c.env))
  )
})

internal.patch('/generations/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const { status, resultVersion, errorCode } = body
  if (!isStatus(status)) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const updated = await finishGeneration(c.env.DB, c.req.param('id'), {
    errorCode: isText(errorCode, 200) ? errorCode : undefined,
    resultVersion:
      typeof resultVersion === 'number' ? resultVersion : undefined,
    status,
  })
  return updated ? c.body(null, 204) : c.json({ code: 'not_found' }, 404)
})

app.route('/internal', internal)

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

// Everyone who has signed in, most recently seen first, with their songs in the last hour and overall
admin.get('/users', async (c) => {
  const since = Date.now() - 3_600_000
  const { results } = await c.env.DB.prepare(
    `select u."id", u."email", u."name", u."image", u."role", u."banned", u."banReason", u."createdAt",
       (select max(s."updatedAt") from "session" s where s."userId" = u."id") as "lastSeenAt",
       case when q."userId" is null then 'default' when q."hourlyLimit" is null then 'unlimited'
         else q."hourlyLimit" end as "hourlyLimit",
       (select count(*) from "generation" g where g."userId" = u."id" and g."createdAt" > ?1
          and g."status" <> 'failed') as "songsLastHour",
       (select count(*) from "generation" g where g."userId" = u."id" and g."status" = 'succeeded')
          as "songsTotal"
     from "user" u left join "quotaOverride" q on q."userId" = u."id"
     order by "lastSeenAt" desc nulls last, u."createdAt" desc`
  )
    .bind(since)
    .all()
  return c.json({ users: results })
})

// The latest generations, newest first, with who asked for them (an account, or a guest)
admin.get('/generations', async (c) => {
  const { results } = await c.env.DB.prepare(
    `select g."id", g."videoId", g."kind", g."status", g."createdAt", g."errorCode", g."resultVersion",
       u."email", u."name", g."guestKey" is not null as "guest"
     from "generation" g left join "user" u on u."id" = g."userId"
     order by g."createdAt" desc limit 200`
  ).all()
  return c.json({ generations: results })
})

// A per-person hourly limit: a number, 'unlimited', or 'default' to go back to USER_HOURLY_LIMIT
admin.put('/users/:id/limit', async (c) => {
  const { hourlyLimit } = await c.req.json<Record<string, unknown>>()
  const id = c.req.param('id')
  if (hourlyLimit === 'default') {
    await c.env.DB.prepare(`delete from "quotaOverride" where "userId" = ?1`)
      .bind(id)
      .run()
    return c.body(null, 204)
  }
  if (
    hourlyLimit !== 'unlimited' &&
    (typeof hourlyLimit !== 'number' ||
      !Number.isInteger(hourlyLimit) ||
      hourlyLimit < 0)
  ) {
    return c.json({ code: 'bad_request' }, 400)
  }
  await c.env.DB.prepare(
    `insert into "quotaOverride" ("userId", "hourlyLimit", "setBy", "setAt") values (?1, ?2, ?3, ?4)
     on conflict ("userId") do update set "hourlyLimit" = ?2, "setBy" = ?3, "setAt" = ?4`
  )
    .bind(
      id,
      hourlyLimit === 'unlimited' ? null : hourlyLimit,
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

app.route('/api/admin', admin)

export default app
