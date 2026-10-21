export type GenerationKind = 'new' | 'regenerate' | 'retime'
export type FinishedStatus = 'running' | 'succeeded' | 'failed'

// Who a generation counts against: a signed-in user, or a guest known only by a hash of their network
export type Owner =
  | { kind: 'user'; id: string }
  | { kind: 'guest'; key: string }

export interface Limits {
  // Per signed-in user in any rolling hour, unless an admin set an override (a number, or none); admins have none
  user: number
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
  // `allowed`: checkGeneration's yes, when nothing was taken
  | { outcome: 'reserved' | 'replay' | 'allowed' }
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
  // SQLite's boolean: an admin set this user's limit; then a null hourlyLimit means none
  overridden: number
  hourlyLimit: number | null
}

interface GenerationRow {
  userId: string | null
  guestKey: string | null
  videoId: string
  status: 'reserved' | 'running' | 'succeeded' | 'failed'
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10)

const HOUR_MS = 3_600_000

const readUser = async (db: D1Database, userId: string) =>
  await db
    .prepare(
      `select u."role", u."banned", q."userId" is not null as "overridden", q."hourlyLimit" from "user" u
       left join "quotaOverride" q on q."userId" = u."id" where u."id" = ?1`
    )
    .bind(userId)
    .first<UserRow>()

const limitFor = (user: UserRow, defaultLimit: number) => {
  if (user.role === 'admin') {
    return null
  }
  return user.overridden === 1 ? user.hourlyLimit : defaultLimit
}

// What a generation is owned by, and which of its songs count: a user's in the last hour, a guest's today.
// The SQL is one of two literals, never input. ?2 owner, ?5 today, ?9 an hour ago
const ownerOf = (owner: Owner) =>
  owner.kind === 'user'
    ? {
        column: '"userId"',
        counted: `"userId" = ?2 and "createdAt" > ?9`,
        value: owner.id,
      }
    : {
        column: '"guestKey"',
        counted: `"guestKey" = ?2 and "utcDay" = ?5`,
        value: owner.key,
      }

// Failed generations never count. ?7 the owner's limit (null: none), ?8 the cap on all guests together
// (null: not a guest)
const slotFree = (
  counted: string
) => `(?7 is null or (select count(*) from "generation"
    where ${counted} and "status" <> 'failed') < ?7)
  and (?8 is null or (select count(*) from "generation"
    where "guestKey" is not null and "utcDay" = ?5 and "status" <> 'failed') < ?8)`

// When the oldest song counted in the user's last hour drops out of it
const userResetsAt = async (db: D1Database, userId: string, now: Date) => {
  const oldest = await db
    .prepare(
      `select min("createdAt") as "oldest" from "generation"
       where "userId" = ?1 and "createdAt" > ?2 and "status" <> 'failed'`
    )
    .bind(userId, now.getTime() - HOUR_MS)
    .first<number | null>('oldest')
  return new Date((oldest ?? now.getTime()) + HOUR_MS).toISOString()
}

export const getQuota = async (
  db: D1Database,
  userId: string,
  limits: Limits,
  now = new Date()
): Promise<Quota> => {
  const user = await readUser(db, userId)
  const used = await db
    .prepare(
      `select count(*) from "generation" where "userId" = ?1 and "createdAt" > ?2 and "status" <> 'failed'`
    )
    .bind(userId, now.getTime() - HOUR_MS)
    .first<number>('count(*)')
  return {
    limit: user ? limitFor(user, limits.user) : 0,
    resetsAt: await userResetsAt(db, userId, now),
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
      resetsAt: await userResetsAt(db, owner.id, now),
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

interface GenerationRequest {
  id: string
  owner: Owner
  videoId: string
  kind: GenerationKind
}

// The refusals that need no free slot, then the owner's limits and the statement bindings for the slot check
type Admitted =
  | { refused: Reservation }
  | {
      bindings: (string | number | null)[]
      day: string
      own: { limit: number | null; cap: number | null }
    }

const admit = async (
  db: D1Database,
  request: GenerationRequest,
  limits: Limits,
  now: Date
): Promise<Admitted> => {
  const enabled = await db
    .prepare(
      `select "value" from "appSetting" where "key" = 'generationEnabled'`
    )
    .first<string>('value')
  if (enabled !== '1') {
    return { refused: { outcome: 'generation_paused' } }
  }
  const own = await ownLimits(db, request.owner, limits)
  if (own === null) {
    return { refused: { outcome: 'forbidden' } }
  }
  const { value } = ownerOf(request.owner)
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
    // ?9, an hour ago: only a user's count reads it, and SQLite refuses a value no placeholder takes
    ...(request.owner.kind === 'user' ? [now.getTime() - HOUR_MS] : []),
  ]
  return { bindings, day, own }
}

// Whether a new song would be reserved, without taking it: the app asks before it starts a generation, so a
// refusal shows at the button instead of partway through
export const checkGeneration = async (
  db: D1Database,
  request: Omit<GenerationRequest, 'id'>,
  limits: Limits,
  now = new Date()
): Promise<Reservation> => {
  const admitted = await admit(db, { ...request, id: '' }, limits, now)
  if ('refused' in admitted) {
    return admitted.refused
  }
  const { bindings, day, own } = admitted
  const free = await db
    .prepare(`select ${slotFree(ownerOf(request.owner).counted)} as "free"`)
    .bind(...bindings)
    .first<number>('free')
  return free === 1
    ? { outcome: 'allowed' }
    : await refusal(db, request.owner, own.limit, limits, day, now)
}

export const reserveGeneration = async (
  db: D1Database,
  request: GenerationRequest,
  limits: Limits,
  now = new Date()
): Promise<Reservation> => {
  const admitted = await admit(db, request, limits, now)
  if ('refused' in admitted) {
    return admitted.refused
  }
  const { bindings, day, own } = admitted
  const { column, counted, value } = ownerOf(request.owner)
  // One statement, so two concurrent requests can't both take the last slot (D1 runs writes one at a time)
  const { meta } = await db
    .prepare(
      `insert into "generation" ("id", ${column}, "videoId", "kind", "status", "utcDay", "createdAt")
       select ?1, ?2, ?3, ?4, 'reserved', ?5, ?6 where ${slotFree(counted)}
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
       where "id" = ?1 and "status" = 'failed' and ${slotFree(counted)}`
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
