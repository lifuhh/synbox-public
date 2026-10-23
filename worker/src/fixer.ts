import { Hono } from 'hono'

import {
  dropReport,
  listOpenReports,
  parseDrop,
  parseResolution,
  resolveReport,
} from './reports'

// The backend's report fixer (every 12 hours): it reads the open reports, fixes the songs, and resolves or drops
// each one. A machine, so no session: a bearer token, the Worker secret REPORTS_FIXER_TOKEN, which the backend
// holds too
export interface FixerEnv {
  DB: D1Database
  REPORTS_FIXER_TOKEN?: string
}

const digest = async (text: string) =>
  new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  )

// Compares digests, so the time taken says nothing about the token's length or how much of it matched
export const bearerMatches = async (
  header: string | undefined,
  token: string | undefined
) => {
  if (token === undefined || token === '' || header === undefined) {
    return false
  }
  const [given, expected] = await Promise.all([
    digest(header),
    digest(`Bearer ${token}`),
  ])
  let diff = 0
  for (const [i, byte] of expected.entries()) {
    // oxlint-disable-next-line no-bitwise -- a constant-time compare
    diff |= byte ^ (given[i] ?? 0)
  }
  return diff === 0
}

export const fixer = new Hono<{ Bindings: FixerEnv }>()

fixer.use(async (c, next) => {
  if (
    !(await bearerMatches(
      c.req.header('Authorization'),
      c.env.REPORTS_FIXER_TOKEN
    ))
  ) {
    return c.json({ code: 'unauthorized' }, 401)
  }
  // oxlint-disable-next-line node/callback-return -- Hono's next() runs the route, which sets c.res
  await next()
  return c.res
})

// Open reports (neither resolved nor dropped), oldest first
fixer.get('/reports', async (c) =>
  c.json({ reports: await listOpenReports(c.env.DB) })
)

// { version, reportedVersion?, note? }: version is the live lyrics version after the fix, required here. A report
// saved without the version its reporter saw (before 2026-10-23, or a song whose lyrics predate versions) takes
// reportedVersion; one that has it keeps its own
fixer.post('/reports/:id/resolve', async (c) => {
  const resolution = parseResolution(
    await c.req.json<unknown>().catch(() => null)
  )
  if (resolution === null || resolution.version === null) {
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

// { reason, note? }; the reporter is never told
fixer.post('/reports/:id/drop', async (c) => {
  const drop = parseDrop(await c.req.json<unknown>().catch(() => null))
  if (drop === null) {
    return c.json({ code: 'bad_request' }, 400)
  }
  const found = await dropReport(c.env.DB, c.req.param('id'), drop, Date.now())
  return found ? c.body(null, 204) : c.json({ code: 'not_found' }, 404)
})
