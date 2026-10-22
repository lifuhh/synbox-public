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

const isVersion = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === 'number' && Number.isInteger(value) && value > 0)

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

// The latest reports, newest first, with who sent them (an account, or a guest)
export const listReports = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `select r."id", r."videoId", r."atSeconds", r."version", r."message", r."client", r."build", r."createdAt",
         u."email", u."name", r."guestKey" is not null as "guest"
       from "report" r left join "user" u on u."id" = r."userId"
       order by r."createdAt" desc limit 200`
    )
    .all()
  return results
}
