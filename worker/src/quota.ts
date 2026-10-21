export type GenerationKind = 'new' | 'regenerate' | 'retime'
export type FinishedStatus = 'running' | 'succeeded' | 'failed'

// Who a generation counts against: a signed-in user, or a guest known only by a hash of their network
export type Owner =
  | { kind: 'user'; id: string }
  | { kind: 'guest'; key: string }

export interface Limits {
  // Per signed-in user per day (null: no limit), unless an admin set an override
  user: number | null
  // Per guest per day, and for all guests together
  guest: number
  guestTotal: number
}

export interface Quota {
  limit: number | null
  used: number
  resetsAt: string
}

export type Reservation =
  | { outcome: 'reserved' | 'replay' }
  | { outcome: 'quota_exceeded'; limit: number; resetsAt: string }
  | {
      outcome:
        | 'generation_paused'
        | 'forbidden'
        | 'already_finished'
        | 'guest_limit'
        | 'guests_full'
    }

interface UserRow {
  role: string | null
  banned: number | null
  dailyLimit: number | null
}

interface GenerationRow {
  userId: string | null
  guestKey: string | null
  videoId: string
  status: 'reserved' | 'running' | 'succeeded' | 'failed'
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10)

const nextUtcMidnight = (now: Date) =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString()

const readUser = async (db: D1Database, userId: string) =>
  await db
    .prepare(
      `select u."role", u."banned", q."dailyLimit" from "user" u
       left join "quotaOverride" q on q."userId" = u."id" where u."id" = ?1`
    )
    .bind(userId)
    .first<UserRow>()

const limitFor = (user: UserRow, defaultLimit: number | null) =>
  user.role === 'admin' ? null : (user.dailyLimit ?? defaultLimit)

// The column and value a generation is owned by. The column name is one of two literals, never input
const ownerOf = (owner: Owner) =>
  owner.kind === 'user'
    ? { column: '"userId"', value: owner.id }
    : { column: '"guestKey"', value: owner.key }

// Failed generations never count. ?2 owner, ?5 day, ?7 the owner's limit (null: none), ?8 the cap on all
// guests together (null: not a guest)
const slotFree = (
  column: string
) => `(?7 is null or (select count(*) from "generation"
    where ${column} = ?2 and "utcDay" = ?5 and "status" <> 'failed') < ?7)
  and (?8 is null or (select count(*) from "generation"
    where "guestKey" is not null and "utcDay" = ?5 and "status" <> 'failed') < ?8)`

export const getQuota = async (
  db: D1Database,
  userId: string,
  limits: Limits,
  now = new Date()
): Promise<Quota> => {
  const user = await readUser(db, userId)
  const used = await db
    .prepare(
      `select count(*) from "generation" where "userId" = ?1 and "utcDay" = ?2 and "status" <> 'failed'`
    )
    .bind(userId, utcDay(now))
    .first<number>('count(*)')
  return {
    limit: user ? limitFor(user, limits.user) : 0,
    resetsAt: nextUtcMidnight(now),
    used: used ?? 0,
  }
}

const ownLimits = async (
  db: D1Database,
  owner: Owner,
  limits: Limits
): Promise<{ limit: number | null; cap: number | null } | null> => {
  if (owner.kind === 'guest') {
    return { cap: limits.guestTotal, limit: limits.guest }
  }
  const user = await readUser(db, owner.id)
  if (user === null || user.banned === 1) {
    return null
  }
  return { cap: null, limit: limitFor(user, limits.user) }
}

// Why the owner was turned away when no slot was free
const refusal = async (
  db: D1Database,
  owner: Owner,
  limit: number | null,
  limits: Limits,
  day: string,
  now: Date
): Promise<Reservation> => {
  if (owner.kind === 'user') {
    return {
      limit: limit ?? 0,
      outcome: 'quota_exceeded',
      resetsAt: nextUtcMidnight(now),
    }
  }
  const mine = await db
    .prepare(
      `select count(*) from "generation" where "guestKey" = ?1 and "utcDay" = ?2 and "status" <> 'failed'`
    )
    .bind(owner.key, day)
    .first<number>('count(*)')
  return (mine ?? 0) >= limits.guest
    ? { outcome: 'guest_limit' }
    : { outcome: 'guests_full' }
}

export const reserveGeneration = async (
  db: D1Database,
  request: { id: string; owner: Owner; videoId: string; kind: GenerationKind },
  limits: Limits,
  now = new Date()
): Promise<Reservation> => {
  const enabled = await db
    .prepare(
      `select "value" from "appSetting" where "key" = 'generationEnabled'`
    )
    .first<string>('value')
  if (enabled !== '1') {
    return { outcome: 'generation_paused' }
  }
  const own = await ownLimits(db, request.owner, limits)
  if (own === null) {
    return { outcome: 'forbidden' }
  }
  const { column, value } = ownerOf(request.owner)
  const day = utcDay(now)
  const bindings = [
    request.id,
    value,
    request.videoId,
    request.kind,
    day,
    now.getTime(),
    own.limit,
    own.cap,
  ]
  // One statement, so two concurrent requests can't both take the last slot (D1 runs writes one at a time)
  const { meta } = await db
    .prepare(
      `insert into "generation" ("id", ${column}, "videoId", "kind", "status", "utcDay", "createdAt")
       select ?1, ?2, ?3, ?4, 'reserved', ?5, ?6 where ${slotFree(column)}
       on conflict ("id") do nothing`
    )
    .bind(...bindings)
    .run()
  if (meta.changes > 0) {
    return { outcome: 'reserved' }
  }
  const existing = await db
    .prepare(
      `select "userId", "guestKey", "videoId", "status" from "generation" where "id" = ?1`
    )
    .bind(request.id)
    .first<GenerationRow>()
  if (existing === null) {
    return await refusal(db, request.owner, own.limit, limits, day, now)
  }
  // A request id is one song for one owner: never a key to another video, or to a second run once it worked
  const existingOwner =
    request.owner.kind === 'user' ? existing.userId : existing.guestKey
  if (existingOwner !== value || existing.videoId !== request.videoId) {
    return { outcome: 'forbidden' }
  }
  if (existing.status === 'succeeded') {
    return { outcome: 'already_finished' }
  }
  if (existing.status !== 'failed') {
    return { outcome: 'replay' }
  }
  // Trying a failed song again counts again, so it needs a free slot like a new one
  const retried = await db
    .prepare(
      `update "generation" set "status" = 'reserved', "errorCode" = null, "finishedAt" = null
       where "id" = ?1 and "status" = 'failed' and ${slotFree(column)}`
    )
    .bind(...bindings)
    .run()
  return retried.meta.changes > 0
    ? { outcome: 'reserved' }
    : await refusal(db, request.owner, own.limit, limits, day, now)
}

export const finishGeneration = async (
  db: D1Database,
  id: string,
  update: {
    status: FinishedStatus
    resultVersion?: number
    errorCode?: string
  },
  now = new Date()
): Promise<boolean> => {
  const { meta } = await db
    .prepare(
      `update "generation" set "status" = ?2, "resultVersion" = ?3, "errorCode" = ?4,
       "finishedAt" = case when ?2 = 'running' then null else ?5 end
       where "id" = ?1 and "status" in ('reserved', 'running')`
    )
    .bind(
      id,
      update.status,
      update.resultVersion ?? null,
      update.errorCode ?? null,
      now.getTime()
    )
    .run()
  return meta.changes > 0
}
