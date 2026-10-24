// What signed-in listeners report about a song's lyrics, for whoever fixes the lyrics pipeline: the song, where in
// it, which lyrics version was on screen, and what was wrong. A few a day per account

export const REPORT_MESSAGE_MAX = 1000
// Per account per day
export const REPORTS_PER_DAY = 20
const DAY_MS = 86_400_000

export interface Report {
  videoId: string
  // Where the song was when the report was opened; null when the player had no time yet
  atSeconds: number | null
  // The lyrics version on screen; null when the player could not tell (a song whose lyrics predate versions)
  version: number | null
  message: string
  // The app build that sent it
  build: string | null
}

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

// Letters, kana and kanji; digits, punctuation, symbols and emoji are not words
const LETTER = /\p{L}/gu
const URL = /(?:https?:\/\/|www\.)\S*/giu
// Whole messages that say nothing: a test, or a run along one keyboard row (asdf, qwer, zxcv...), maybe repeated
const MASH = new Set(['test', 'testing', 'tst', 'テスト', 'てすと'])
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

const repeats = (text: string, unit: string) =>
  unit !== '' &&
  text.length % unit.length === 0 &&
  unit.repeat(text.length / unit.length) === text

// The letters are one unit over and over, and that unit is a single letter, a test word or a keyboard-row run
const isMash = (letters: string) => {
  for (let size = 1; size <= letters.length; size += 1) {
    const unit = letters.slice(0, size)
    if (
      repeats(letters, unit) &&
      (size === 1 ||
        MASH.has(unit) ||
        (size >= 3 && KEY_ROWS.some((row) => row.includes(unit))))
    ) {
      return true
    }
  }
  return false
}

// A message nobody could act on: under 2 letters once links are taken out, one letter repeated (aaaa), or keyboard
// mash and test words. Kept narrow on purpose: "wrong", "out of sync" and "歌詞ずれ" are real reports
export const isUninformative = (message: string) => {
  const letters = (message.replace(URL, ' ').match(LETTER) ?? [])
    .join('')
    .toLowerCase()
  return letters.length < 2 || isMash(letters)
}

export type ParsedReport =
  | { ok: true; report: Report }
  | { ok: false; code: 'bad_request' | 'uninformative' }

// The body of POST /api/reports: bad_request when any field is off, uninformative when the message says nothing
export const parseReport = (body: unknown): ParsedReport => {
  if (typeof body !== 'object' || body === null) {
    return { code: 'bad_request', ok: false }
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
    return { code: 'bad_request', ok: false }
  }
  if (isUninformative(text)) {
    return { code: 'uninformative', ok: false }
  }
  return {
    ok: true,
    report: {
      atSeconds: atSeconds === null ? null : Math.round(atSeconds * 10) / 10,
      build,
      message: text,
      version,
      videoId,
    },
  }
}

export const reportAllowed = async (
  db: D1Database,
  userId: string,
  now: number
) =>
  Number(
    (await db
      .prepare(
        `select count(*) as "n" from "report" where "userId" = ?1 and "createdAt" > ?2`
      )
      .bind(userId, now - DAY_MS)
      .first('n')) ?? 0
  ) < REPORTS_PER_DAY

// Old rows may carry a guestKey (reporting was open to guests until 2026-10-23); new ones never do
export const saveReport = async (
  db: D1Database,
  userId: string,
  report: Report,
  client: string,
  now: number
) => {
  await db
    .prepare(
      `insert into "report" ("id", "videoId", "atSeconds", "version", "message", "userId", "client", "build",
         "createdAt") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    )
    .bind(
      crypto.randomUUID(),
      report.videoId,
      report.atSeconds,
      report.version,
      report.message,
      userId,
      client.slice(0, 300),
      report.build,
      now
    )
    .run()
}

// Neither resolved nor dropped
const OPEN = `"resolvedAt" is null and "droppedAt" is null`

// The latest reports with who sent them (an account, or a guest before 2026-10-23): open ones first, so closed ones
// never push an open one out of the 200, then newest first
export const listReports = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `select r."id", r."videoId", r."atSeconds", r."version", r."message", r."client", r."build", r."createdAt",
         r."resolvedAt", r."resolvedVersion", r."resolution", r."droppedAt", r."dropReason",
         u."email", u."name", r."guestKey" is not null as "guest"
       from "report" r left join "user" u on u."id" = r."userId"
       order by not (${OPEN}), r."createdAt" desc limit 200`
    )
    .all()
  return results
}

// What the backend's fixer works through: open reports, oldest first. None stays open past EXPIRE_DAYS
export const listOpenReports = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `select "id", "videoId", "atSeconds", "version", "message", "createdAt" from "report" where ${OPEN}
       order by "createdAt" limit 500`
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
// again with another fixing version tells the reporter again. A dropped report stops being dropped
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
         "dismissedAt" = case when "resolvedVersion" is ?3 then "dismissedAt" end,
         "droppedAt" = null, "dropReason" = null
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
         "dismissedAt" = null, "droppedAt" = null, "dropReason" = null where "id" = ?1`
    )
    .bind(id)
    .run()
  return meta.changes > 0
}

// Why a report was closed without a fix. The reporter is never told
export const DROP_REASONS = [
  'uninformative',
  'no_lyrics',
  'duplicate',
  'nothing_found',
  'expired',
] as const
export type DropReason = (typeof DROP_REASONS)[number]

export interface Drop {
  reason: DropReason
  note: string | null
}

const isDropReason = (value: unknown): value is DropReason =>
  DROP_REASONS.some((reason) => reason === value)

// The body of POST /api/admin/reports/:id/drop and /api/fixer/reports/:id/drop ({ reason, note? }), or null when
// either is off
export const parseDrop = (body: unknown): Drop | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const reason = field(body, 'reason')
  const note = field(body, 'note') ?? null
  if (!isDropReason(reason) || (note !== null && typeof note !== 'string')) {
    return null
  }
  const text = note?.trim() ?? ''
  if (text.length > RESOLUTION_MAX) {
    return null
  }
  return { note: text === '' ? null : text, reason }
}

// False when no report has the id. Dropping closes it without a fix: any resolve, and the reporter's notification
// of it, goes. The note is kept in "resolution", the closing note of either kind
export const dropReport = async (
  db: D1Database,
  id: string,
  { reason, note }: Drop,
  now: number
) => {
  const { meta } = await db
    .prepare(
      `update "report" set "droppedAt" = ?2, "dropReason" = ?3, "resolution" = ?4, "resolvedAt" = null,
         "resolvedVersion" = null, "seenAt" = null, "dismissedAt" = null
       where "id" = ?1`
    )
    .bind(id, now, reason, note)
    .run()
  return meta.changes > 0
}

// The safety net under the 12-hourly fixer: a report still open after this long is dropped as expired
export const EXPIRE_DAYS = 3

// Drops every report open for EXPIRE_DAYS or more; answers how many. Running it again changes nothing
export const expireReports = async (db: D1Database, now: number) => {
  const { meta } = await db
    .prepare(
      `update "report" set "droppedAt" = ?1, "dropReason" = 'expired' where ${OPEN} and "createdAt" <= ?2`
    )
    .bind(now, now - EXPIRE_DAYS * DAY_MS)
    .run()
  return meta.changes
}

// A fix stays in the reporter's notifications until they dismiss it; the newest this many are listed
const FIX_MAX = 50

// A signed-in reporter's report that was resolved with other lyrics than the ones they reported. Guests' old reports
// get none (their key was a network's), and a dropped report never tells anyone
const FIXED = `"userId" = ?1 and "resolvedVersion" is not null
  and ("version" is null or "resolvedVersion" <> "version") and "droppedAt" is null`

// The caller's fixed songs not dismissed, newest fix first: several reports of one song are one notification,
// seen once all of them are
export const listFixes = async (db: D1Database, userId: string) => {
  const { results } = await db
    .prepare(
      `select "videoId", max("resolvedAt") as "fixedAt", min("seenAt" is not null) as "seen" from "report"
       where ${FIXED} and "dismissedAt" is null
       group by "videoId" order by "fixedAt" desc limit ${FIX_MAX}`
    )
    .bind(userId)
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
  const dismissedAt = mark === 'dismissed' ? '?2' : '"dismissedAt"'
  await db
    .prepare(
      `update "report" set "seenAt" = coalesce("seenAt", ?2), "dismissedAt" = ${dismissedAt}
       where ${FIXED} and "resolvedAt" <= ?3 and "dismissedAt" is null
         and "videoId" in (select "value" from json_each(?4))`
    )
    .bind(userId, now, upTo, JSON.stringify(videoIds))
    .run()
}
