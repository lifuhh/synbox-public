// Send Feedback: a subject and a message about the app, from an account or a guest. An account may send it
// anonymously; a guest always does. An anonymous row keeps nothing about its sender, and the daily limits that still
// apply to it are counted in a table of their own (feedbackCount) that holds no message id and no time but the UTC
// day, so a count can't be joined to a message. Resolving a signed feedback tells its sender in the app's
// notifications, the way a fixed report does (reports.ts › listFixes)

export const SUBJECT_MAX = 120
export const MESSAGE_MAX = 4000
// A day (UTC) per account, and per network for everyone on it, guests included
export const ACCOUNT_PER_DAY = 5
export const NETWORK_PER_DAY = 20
const DAY_MS = 86_400_000

export interface Feedback {
  subject: string
  message: string
  anonymous: boolean
}

// trap: the hidden field only bots fill in. The form answers it as sent, and nothing is kept
export type ParsedFeedback =
  | { ok: true; feedback: Feedback }
  | { ok: false; code: 'bad_request' | 'trap' }

const field = (body: object, key: string): unknown => Reflect.get(body, key)

const text = (body: object, key: string) => {
  const value = field(body, key)
  return typeof value === 'string' ? value.trim() : ''
}

// The body of POST /api/feedback: { subject, message, anonymous }. Anything else about the sender is ignored
export const parseFeedback = (body: unknown): ParsedFeedback => {
  if (typeof body !== 'object' || body === null) {
    return { code: 'bad_request', ok: false }
  }
  if (text(body, 'website') !== '') {
    return { code: 'trap', ok: false }
  }
  const subject = text(body, 'subject')
  const message = text(body, 'message')
  const anonymous = field(body, 'anonymous')
  if (
    subject === '' ||
    subject.length > SUBJECT_MAX ||
    message.length < 2 ||
    message.length > MESSAGE_MAX ||
    typeof anonymous !== 'boolean'
  ) {
    return { code: 'bad_request', ok: false }
  }
  return { feedback: { anonymous, message, subject }, ok: true }
}

const dayOf = (now: number) => Math.floor(now / DAY_MS)

const hash = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// Who a send counts against: the network always, the account when signed in (anonymous or not)
export interface Sender {
  userId: string | null
  address: string
}

const countersOf = async ({ userId, address }: Sender, day: number) => {
  const counters = [
    {
      key: await hash(`feedback:${day}:n:${address}`),
      limit: NETWORK_PER_DAY,
    },
  ]
  if (userId !== null) {
    counters.push({
      key: await hash(`feedback:${day}:u:${userId}`),
      limit: ACCOUNT_PER_DAY,
    })
  }
  return counters
}

// Counts one send against each of the sender's counters, or none of them when any is at its limit: false then
export const takeSend = async (db: D1Database, sender: Sender, now: number) => {
  const day = dayOf(now)
  const counters = await countersOf(sender, day)
  const sent = await Promise.all(
    counters.map(
      async ({ key }) =>
        await db
          .prepare(`select "n" from "feedbackCount" where "key" = ?1`)
          .bind(key)
          .first('n')
    )
  )
  if (counters.some(({ limit }, i) => Number(sent[i] ?? 0) >= limit)) {
    return false
  }
  await db.batch(
    counters.map(({ key }) =>
      db
        .prepare(
          `insert into "feedbackCount" ("key", "day", "n") values (?1, ?2, 1)
           on conflict ("key") do update set "n" = "n" + 1`
        )
        .bind(key, day)
    )
  )
  return true
}

// The counters of days before today: the cron's, daily
export const pruneFeedbackCounts = async (db: D1Database, now: number) => {
  await db
    .prepare(`delete from "feedbackCount" where "day" < ?1`)
    .bind(dayOf(now))
    .run()
}

// userId: null for anonymous feedback, whoever sent it
export const saveFeedback = async (
  db: D1Database,
  feedback: Feedback,
  userId: string | null,
  now: number
) => {
  await db
    .prepare(
      `insert into "feedback" ("createdAt", "userId", "subject", "message") values (?1, ?2, ?3, ?4)`
    )
    .bind(
      now,
      feedback.anonymous ? null : userId,
      feedback.subject,
      feedback.message
    )
    .run()
}

// The latest feedback, open first, then newest first; an anonymous one has no account to join
export const listFeedback = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `select f."id", f."createdAt", f."subject", f."message", f."resolvedAt", f."droppedAt",
         f."userId" is null as "anonymous", u."name", u."email"
       from "feedback" f left join "user" u on u."id" = f."userId"
       order by (f."resolvedAt" is not null or f."droppedAt" is not null), f."createdAt" desc limit 200`
    )
    .all()
  return results
}

export type FeedbackChange = 'resolve' | 'drop' | 'reopen'

// False when no feedback has the id. Resolve and drop each clear the other; resolving again after a reopen tells the
// sender again. Dropping tells nobody
export const changeFeedback = async (
  db: D1Database,
  id: number,
  change: FeedbackChange,
  now: number
) => {
  const { meta } = await db
    .prepare(
      `update "feedback" set "resolvedAt" = case when ?3 = 'resolve' then ?2 end,
         "droppedAt" = case when ?3 = 'drop' then ?2 end, "seenAt" = null, "dismissedAt" = null
       where "id" = ?1`
    )
    .bind(id, now, change)
    .run()
  return meta.changes > 0
}

// Resolved feedback stays in its sender's notifications until they dismiss it, or READ_DAYS after they saw it, as a
// fixed report does (reports.ts › FIX_READ_DAYS); the newest this many are listed
const RESOLVED_MAX = 50
const READ_DAYS = 3

const RESOLVED = `"userId" = ?1 and "resolvedAt" is not null`

// The caller's resolved feedback not dismissed, newest first
export const listResolved = async (
  db: D1Database,
  userId: string,
  now: number
) => {
  const { results } = await db
    .prepare(
      `select "id", "subject", "resolvedAt", "seenAt" is not null as "seen" from "feedback"
       where ${RESOLVED} and "dismissedAt" is null and ("seenAt" is null or "seenAt" >= ?2)
       order by "resolvedAt" desc limit ${RESOLVED_MAX}`
    )
    .bind(userId, now - READ_DAYS * DAY_MS)
    .all<{ id: number; subject: string; resolvedAt: number; seen: number }>()
  return results.map(({ id, subject, resolvedAt, seen }) => ({
    id,
    resolvedAt,
    seen: seen === 1,
    subject,
  }))
}

export interface ResolvedMarks {
  ids: number[]
  // The newest resolvedAt the caller was shown: one resolved after it is left alone
  upTo: number
}

// The body of POST /api/me/feedback/seen and /dismiss, or null when any field is off
export const parseResolvedMarks = (body: unknown): ResolvedMarks | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const ids = field(body, 'ids')
  const upTo = field(body, 'upTo')
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > RESOLVED_MAX ||
    !ids.every((id): id is number => Number.isInteger(id)) ||
    typeof upTo !== 'number' ||
    !Number.isInteger(upTo)
  ) {
    return null
  }
  return { ids, upTo }
}

// Only the caller's own feedback changes
export const markResolved = async (
  db: D1Database,
  userId: string,
  { ids, upTo }: ResolvedMarks,
  mark: 'seen' | 'dismissed',
  now: number
) => {
  const dismissedAt = mark === 'dismissed' ? '?2' : '"dismissedAt"'
  await db
    .prepare(
      `update "feedback" set "seenAt" = coalesce("seenAt", ?2), "dismissedAt" = ${dismissedAt}
       where ${RESOLVED} and "resolvedAt" <= ?3 and "dismissedAt" is null
         and "id" in (select "value" from json_each(?4))`
    )
    .bind(userId, now, upTo, JSON.stringify(ids))
    .run()
}
