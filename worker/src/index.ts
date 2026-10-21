import { Hono } from 'hono'

import { createAuth } from './auth'
import type { Env } from './auth'
import { finishGeneration, getQuota, reserveGeneration } from './quota'
import type { FinishedStatus, GenerationKind } from './quota'

type AppEnv = Env & { DEFAULT_DAILY_LIMIT: string }

const app = new Hono<{ Bindings: AppEnv }>()

const defaultLimit = (env: AppEnv) => Number(env.DEFAULT_DAILY_LIMIT ?? '0')

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
    quota: await getQuota(c.env.DB, id, defaultLimit(c.env)),
    user: { email, id, image, name, role: role ?? 'user' },
  })
})

// Called only by the Cloud Run backend, after it has verified the user's JWT
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
  already_finished: 409,
  forbidden: 403,
  generation_paused: 503,
  quota_exceeded: 429,
  replay: 200,
  reserved: 201,
} as const

internal.post('/generations', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const { id, userId, videoId, kind } = body
  if (!isText(id) || !isText(userId) || !isText(videoId) || !isKind(kind)) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const reservation = await reserveGeneration(
    c.env.DB,
    { id, kind, userId, videoId },
    defaultLimit(c.env)
  )
  const status = RESERVATION_STATUS[reservation.outcome]
  return reservation.outcome === 'reserved' || reservation.outcome === 'replay'
    ? c.json(reservation, status)
    : c.json({ ...reservation, code: reservation.outcome }, status)
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

export default app
