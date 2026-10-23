// What listeners report about a song's lyrics, for whoever fixes the lyrics pipeline: the song, where in it,
// which lyrics version was on screen, and what was wrong. Anyone may send one, a few a day

export const REPORT_MESSAGE_MAX = 1000
// Per person per day. A guest's key comes from an address a caller can forge, so guests also share a daily total
export const REPORT_LIMITS = { guest: 5, guestTotal: 200, user: 20 }
const DAY_MS = 86_400_000

export interface Report {
  videoId: string
  // Where the song was when the report was opened; null when the player had no time yet
  atSeconds: number | null
  // The lyrics version on screen; null for the song's current lyrics
  version: number | null
  message: string
  // The app build that sent it
  build: string | null
}

export type Reporter =
  | { kind: 'user'; id: string }
  | { kind: 'guest'; key: string }

const VIDEO_ID = /^[\w-]{11}$/u
const BUILD = /^[\w.-]{1,40}$/u

const field = (body: object, key: string): unknown => Reflect.get(body, key)

const isTime = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === 'number' && value >= 0 && value < DAY_MS / 1000)

// A song's first lyrics are version 0
const isVersion = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === 'number' && Number.isInteger(value) && value >= 0)

const isBuild = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && BUILD.test(value))

// The body of POST /api/reports, or null when any field is off
export const parseReport = (body: unknown): Report | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const videoId = field(body, 'videoId')
  const atSeconds = field(body, 'atSeconds') ?? null
  const version = field(body, 'version') ?? null
  const message = field(body, 'message')
  const build = field(body, 'build') ?? null
  const text = typeof message === 'string' ? message.trim() : ''
  if (
    typeof videoId !== 'string' ||
    !VIDEO_ID.test(videoId) ||
    text === '' ||
    text.length > REPORT_MESSAGE_MAX ||
    !isTime(atSeconds) ||
    !isVersion(version) ||
    !isBuild(build)
  ) {
    return null
  }
  return {
    atSeconds: atSeconds === null ? null : Math.round(atSeconds * 10) / 10,
    build,
    message: text,
    version,
    videoId,
  }
}

// The caller's address as Netlify passed it on, grouped per IPv6 /64 (one home's devices share it), hashed with
// a secret so the database never holds an address
export const guestKeyOf = async (headers: Headers, secret: string) => {
  const address =
    headers.get('x-nf-client-connection-ip') ??
    headers.get('cf-connecting-ip') ??
    ''
  const group = address.includes(':')
    ? address.split(':').slice(0, 4).join(':')
    : address
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`report:${group}`)
  )
  return [...new Uint8Array(mac).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const countSince = async (db: D1Database, sql: string, ...params: unknown[]) =>
  Number(
    (await db
      .prepare(sql)
      .bind(...params)
      .first('n')) ?? 0
  )

export const reportAllowed = async (
  db: D1Database,
  reporter: Reporter,
  now: number
) => {
  const since = now - DAY_MS
  if (reporter.kind === 'user') {
    return (
      (await countSince(
        db,
        `select count(*) as "n" from "report" where "userId" = ?1 and "createdAt" > ?2`,
        reporter.id,
        since
      )) < REPORT_LIMITS.user
    )
  }
  const mine = await countSince(
    db,
    `select count(*) as "n" from "report" where "guestKey" = ?1 and "createdAt" > ?2`,
    reporter.key,
    since
  )
  const guests = await countSince(
    db,
    `select count(*) as "n" from "report" where "guestKey" is not null and "createdAt" > ?1`,
    since
  )
  return mine < REPORT_LIMITS.guest && guests < REPORT_LIMITS.guestTotal
}

export const saveReport = async (
  db: D1Database,
  reporter: Reporter,
  report: Report,
  client: string,
  now: number
) => {
  await db
    .prepare(
      `insert into "report" ("id", "videoId", "atSeconds", "version", "message", "userId", "guestKey", "client",
         "build", "createdAt") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    )
    .bind(
      crypto.randomUUID(),
      report.videoId,
      report.atSeconds,
      report.version,
      report.message,
      reporter.kind === 'user' ? reporter.id : null,
      reporter.kind === 'guest' ? reporter.key : null,
      client.slice(0, 300),
      report.build,
      now
    )
    .run()
}

// The latest reports with who sent them (an account, or a guest): open ones first, so resolved ones never push
// an open one out of the 200, then newest first
export const listReports = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `select r."id", r."videoId", r."atSeconds", r."version", r."message", r."client", r."build", r."createdAt",
         r."resolvedAt", r."resolvedVersion", r."resolution",
         u."email", u."name", r."guestKey" is not null as "guest"
       from "report" r left join "user" u on u."id" = r."userId"
       order by r."resolvedAt" is not null, r."createdAt" desc limit 200`
    )
    .all()
  return results
}

export const RESOLUTION_MAX = 300

export interface Resolution {
  // The lyrics version that fixed it
  version: number | null
  // For a report sent without a version (a listener sees the song's current lyrics): the version that was live
  // when it was sent, so a resolve with the same lyrics tells the reporter nothing
  reportedVersion: number | null
  note: string | null
}

// The body of POST /api/admin/reports/:id/resolve: both fields optional, or null when either is off
export const parseResolution = (body: unknown): Resolution | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const version = field(body, 'version') ?? null
  const reportedVersion = field(body, 'reportedVersion') ?? null
  const note = field(body, 'note') ?? null
  if (
    !isVersion(version) ||
    !isVersion(reportedVersion) ||
    (note !== null && typeof note !== 'string')
  ) {
    return null
  }
  const text = note?.trim() ?? ''
  if (text.length > RESOLUTION_MAX) {
    return null
  }
  return { note: text === '' ? null : text, reportedVersion, version }
}

// False when no report has the id. A report sent without a version takes the one live when it was sent. Resolving
// again with another fixing version tells the reporter again
export const resolveReport = async (
  db: D1Database,
  id: string,
  { version, reportedVersion, note }: Resolution,
  now: number
) => {
  const { meta } = await db
    .prepare(
      `update "report" set "resolvedAt" = ?2, "resolvedVersion" = ?3, "resolution" = ?4,
         "version" = coalesce("version", ?5),
         "seenAt" = case when "resolvedVersion" is ?3 then "seenAt" end,
         "dismissedAt" = case when "resolvedVersion" is ?3 then "dismissedAt" end
       where "id" = ?1`
    )
    .bind(id, now, version, note, reportedVersion)
    .run()
  return meta.changes > 0
}

// False when no report has the id
export const reopenReport = async (db: D1Database, id: string) => {
  const { meta } = await db
    .prepare(
      `update "report" set "resolvedAt" = null, "resolvedVersion" = null, "resolution" = null, "seenAt" = null,
         "dismissedAt" = null where "id" = ?1`
    )
    .bind(id)
    .run()
  return meta.changes > 0
}

// A fix stays in the reporter's notifications this long after it was resolved, read or not
export const FIX_DAYS = 30
const FIX_MAX = 50

// A signed-in reporter's report that was resolved with other lyrics than the ones they reported. Guests get none:
// their key is a network's, shared by a home and changed by a phone's mobile network
const FIXED = `"userId" = ?1 and "resolvedAt" > ?2 and "resolvedVersion" is not null
  and ("version" is null or "resolvedVersion" <> "version")`

// The caller's fixed songs not dismissed, newest fix first: several reports of one song are one notification,
// seen once all of them are
export const listFixes = async (
  db: D1Database,
  userId: string,
  now: number
) => {
  const { results } = await db
    .prepare(
      `select "videoId", max("resolvedAt") as "fixedAt", min("seenAt" is not null) as "seen" from "report"
       where ${FIXED} and "dismissedAt" is null
       group by "videoId" order by "fixedAt" desc limit ${FIX_MAX}`
    )
    .bind(userId, now - FIX_DAYS * DAY_MS)
    .all<{ videoId: string; fixedAt: number; seen: number }>()
  return results.map(({ videoId, fixedAt, seen }) => ({
    fixedAt,
    seen: seen === 1,
    videoId,
  }))
}

export interface FixMarks {
  videoIds: string[]
  // The newest fixedAt the caller was shown: a fix resolved after it is left alone
  upTo: number
}

// The body of POST /api/me/fixes/seen and /dismiss, or null when any field is off
export const parseFixMarks = (body: unknown): FixMarks | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const videoIds = field(body, 'videoIds')
  const upTo = field(body, 'upTo')
  if (
    !Array.isArray(videoIds) ||
    videoIds.length === 0 ||
    videoIds.length > FIX_MAX ||
    !videoIds.every(
      (videoId): videoId is string =>
        typeof videoId === 'string' && VIDEO_ID.test(videoId)
    ) ||
    typeof upTo !== 'number' ||
    !Number.isInteger(upTo)
  ) {
    return null
  }
  return { upTo, videoIds }
}

// Only the caller's own fixes change; another account's reports of the same songs are left alone
export const markFixes = async (
  db: D1Database,
  userId: string,
  { videoIds, upTo }: FixMarks,
  mark: 'seen' | 'dismissed',
  now: number
) => {
  const dismissedAt = mark === 'dismissed' ? '?3' : '"dismissedAt"'
  await db
    .prepare(
      `update "report" set "seenAt" = coalesce("seenAt", ?3), "dismissedAt" = ${dismissedAt}
       where ${FIXED} and "resolvedAt" <= ?4 and "dismissedAt" is null
         and "videoId" in (select "value" from json_each(?5))`
    )
    .bind(userId, now - FIX_DAYS * DAY_MS, now, upTo, JSON.stringify(videoIds))
    .run()
}
