export type GenerationKind = 'new' | 'regenerate' | 'retime'
export type FinishedStatus = 'running' | 'succeeded' | 'failed'

// Who a generation counts against: a signed-in user, or a guest known only by a hash of their network
export type Owner =
  | { kind: 'user'; id: string }
  | { kind: 'guest'; key: string }

export interface Limits {
  // Per signed-in user in any rolling 24 hours, unless an admin set an override (a number, or none); admins have none
  user: number
  // Per guest per day, and for all guests together
  guest: number
  guestTotal: number
  // Per network in any rolling 24 hours, for its guests and its accounts under the default limit together, so a
  // second account on the same network doesn't bring a fresh allowance
  network: number
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
        | 'network_limit'
    }

interface UserRow {
  role: string | null
  banned: number | null
  // SQLite's boolean: an admin set this user's limit; then a null dailyLimit means none
  overridden: number
  dailyLimit: number | null
}

interface GenerationRow {
  userId: string | null
  guestKey: string | null
  videoId: string
  status: 'reserved' | 'running' | 'succeeded' | 'failed'
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10)

const DAY_MS = 86_400_000
// A generation the backend hasn't reported on for this long has stopped: the app gave up, was put away, or the
// instance running it died. The backend reports every stage and every tenth of one, so a live one never gets here
const STALL_MS = 15 * 60_000

// Lets go of stopped generations, so they show as stopped and stop counting against their owner
export const expireStalled = async (db: D1Database, now = new Date()) => {
  await db
    .prepare(
      `update "generation" set "status" = 'failed', "errorCode" = 'abandoned', "finishedAt" = ?1
       where "status" in ('reserved', 'running') and coalesce("updatedAt", "createdAt") < ?2`
    )
    .bind(now.getTime(), now.getTime() - STALL_MS)
    .run()
}

const readUser = async (db: D1Database, userId: string) =>
  await db
    .prepare(
      `select u."role", u."banned", q."userId" is not null as "overridden", q."dailyLimit" from "user" u
       left join "quotaOverride" q on q."userId" = u."id" where u."id" = ?1`
    )
    .bind(userId)
    .first<UserRow>()

const limitFor = (user: UserRow, defaultLimit: number) => {
  if (user.role === 'admin') {
    return null
  }
  return user.overridden === 1 ? user.dailyLimit : defaultLimit
}

// What a generation is owned by, and which of its songs count: a user's in the last 24 hours, a guest's today.
// The SQL is one of two literals, never input. ?2 owner, ?5 today, ?9 a day ago
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

// The network's songs in the last 24 hours that count toward its cap. ?9 a day ago, ?10 the network
const NETWORK_COUNT = `(select count(*) from "generation"
    where "networkKey" = ?10 and "capped" = 1 and "createdAt" > ?9 and "status" <> 'failed')`

// Failed generations never count. ?7 the owner's limit (null: none), ?8 the cap on all guests together
// (null: not a guest), ?10 the caller's network (null: unknown), ?11 the network's limit, ?13 whether this owner
// is held to it (1: a guest or an account under the default limit)
const slotFree = (
  counted: string
) => `(?7 is null or (select count(*) from "generation"
    where ${counted} and "status" <> 'failed') < ?7)
  and (?8 is null or (select count(*) from "generation"
    where "guestKey" is not null and "utcDay" = ?5 and "status" <> 'failed') < ?8)
  and (?13 = 0 or ?10 is null or ${NETWORK_COUNT} < ?11)`

// When the oldest song counted in the user's last 24 hours drops out of it
const userResetsAt = async (db: D1Database, userId: string, now: Date) => {
  const oldest = await db
    .prepare(
      `select min("createdAt") as "oldest" from "generation"
       where "userId" = ?1 and "createdAt" > ?2 and "status" <> 'failed'`
    )
    .bind(userId, now.getTime() - DAY_MS)
    .first<number | null>('oldest')
  return new Date((oldest ?? now.getTime()) + DAY_MS).toISOString()
}

export const getQuota = async (
  db: D1Database,
  userId: string,
  limits: Limits,
  now = new Date()
): Promise<Quota> => {
  await expireStalled(db, now)
  const user = await readUser(db, userId)
  const used = await db
    .prepare(
      `select count(*) from "generation" where "userId" = ?1 and "createdAt" > ?2 and "status" <> 'failed'`
    )
    .bind(userId, now.getTime() - DAY_MS)
    .first<number>('count(*)')
  return {
    limit: user ? limitFor(user, limits.user) : 0,
    resetsAt: await userResetsAt(db, userId, now),
    used: used ?? 0,
  }
}

interface OwnLimits {
  limit: number | null
  cap: number | null
  // Counts toward, and is held to, its network's cap
  capped: boolean
}

const ownLimits = async (
  db: D1Database,
  owner: Owner,
  limits: Limits
): Promise<OwnLimits | null> => {
  if (owner.kind === 'guest') {
    return { cap: limits.guestTotal, capped: true, limit: limits.guest }
  }
  const user = await readUser(db, owner.id)
  if (user === null || user.banned === 1) {
    return null
  }
  return {
    cap: null,
    capped: user.role !== 'admin' && user.overridden !== 1,
    limit: limitFor(user, limits.user),
  }
}

const count = async (
  db: D1Database,
  sql: string,
  ...values: (string | number)[]
) =>
  (await db
    .prepare(
      `select count(*) from "generation" where ${sql} and "status" <> 'failed'`
    )
    .bind(...values)
    .first<number>('count(*)')) ?? 0

const networkFull = async (
  db: D1Database,
  network: string | null,
  limits: Limits,
  now: Date
) =>
  network !== null &&
  (await count(
    db,
    `"networkKey" = ?1 and "capped" = 1 and "createdAt" > ?2`,
    network,
    now.getTime() - DAY_MS
  )) >= limits.network

// Why the owner was turned away when no slot was free: its own limit first, then the shared ones
const refusal = async (
  db: D1Database,
  request: Pick<GenerationRequest, 'owner' | 'network'>,
  own: OwnLimits,
  limits: Limits,
  day: string,
  now: Date
): Promise<Reservation> => {
  const { owner } = request
  const network = request.network ?? null
  if (owner.kind === 'user') {
    const used = await count(
      db,
      `"userId" = ?1 and "createdAt" > ?2`,
      owner.id,
      now.getTime() - DAY_MS
    )
    if (
      (own.limit === null || used < own.limit) &&
      (await networkFull(db, network, limits, now))
    ) {
      return { outcome: 'network_limit' }
    }
    return {
      limit: own.limit ?? 0,
      outcome: 'quota_exceeded',
      resetsAt: await userResetsAt(db, owner.id, now),
    }
  }
  if (
    (await count(db, `"guestKey" = ?1 and "utcDay" = ?2`, owner.key, day)) >=
    limits.guest
  ) {
    return { outcome: 'guest_limit' }
  }
  return (await count(db, `"guestKey" is not null and "utcDay" = ?1`, day)) >=
    limits.guestTotal
    ? { outcome: 'guests_full' }
    : { outcome: 'network_limit' }
}

// A reservation turned away at a limit, kept for the admin page's signals (a check, which takes nothing, is not)
const LIMIT_REFUSALS = new Set<Reservation['outcome']>([
  'quota_exceeded',
  'guest_limit',
  'guests_full',
  'network_limit',
])

const recorded = async (
  db: D1Database,
  request: GenerationRequest,
  reservation: Reservation,
  now: Date
) => {
  if (LIMIT_REFUSALS.has(reservation.outcome)) {
    const { owner } = request
    await db
      .prepare(
        `insert into "refusal" ("code", "userId", "guestKey", "networkKey", "client", "createdAt")
         values (?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(
        reservation.outcome,
        owner.kind === 'user' ? owner.id : null,
        owner.kind === 'guest' ? owner.key : null,
        request.network ?? null,
        request.client ?? null,
        now.getTime()
      )
      .run()
  }
  return reservation
}

interface GenerationRequest {
  id: string
  owner: Owner
  videoId: string
  kind: GenerationKind
  // The backend's keyed hash of the caller's network, and the caller's user agent; null when not sent
  network?: string | null
  client?: string | null
}

// The refusals that need no free slot, then the owner's limits and the statement bindings for the slot check
type Admitted =
  | { refused: Reservation }
  | {
      bindings: (string | number | null)[]
      day: string
      own: OwnLimits
    }

const admit = async (
  db: D1Database,
  request: GenerationRequest,
  limits: Limits,
  now: Date
): Promise<Admitted> => {
  await expireStalled(db, now)
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
    now.getTime() - DAY_MS,
    request.network ?? null,
    limits.network,
    request.client ?? null,
    own.capped ? 1 : 0,
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
    : await refusal(db, request, own, limits, day, now)
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
      `insert into "generation" ("id", ${column}, "videoId", "kind", "status", "utcDay", "createdAt", "updatedAt",
         "networkKey", "client", "capped")
       select ?1, ?2, ?3, ?4, 'reserved', ?5, ?6, ?6, ?10, ?12, ?13 where ${slotFree(counted)}
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
    return await recorded(
      db,
      request,
      await refusal(db, request, own, limits, day, now),
      now
    )
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
      `update "generation" set "status" = 'reserved', "errorCode" = null, "finishedAt" = null, "updatedAt" = ?6,
       "stage" = null, "fraction" = null
       where "id" = ?1 and "status" = 'failed' and ${slotFree(counted)}`
    )
    .bind(...bindings)
    .run()
  return retried.meta.changes > 0
    ? { outcome: 'reserved' }
    : await recorded(
        db,
        request,
        await refusal(db, request, own, limits, day, now),
        now
      )
}

// A finished generation, or a running one's progress (`running` with its stage and fraction)
export const finishGeneration = async (
  db: D1Database,
  id: string,
  update: {
    status: FinishedStatus
    resultVersion?: number
    errorCode?: string
    stage?: string
    fraction?: number
  },
  now = new Date()
): Promise<boolean> => {
  const { meta } = await db
    .prepare(
      `update "generation" set "status" = ?2, "resultVersion" = ?3, "errorCode" = ?4,
       "finishedAt" = case when ?2 = 'running' then null else ?5 end, "updatedAt" = ?5,
       "stage" = coalesce(?6, "stage"), "fraction" = case when ?2 = 'running' then ?7 end
       where "id" = ?1 and "status" in ('reserved', 'running')`
    )
    .bind(
      id,
      update.status,
      update.resultVersion ?? null,
      update.errorCode ?? null,
      now.getTime(),
      update.stage ?? null,
      update.fraction ?? null
    )
    .run()
  return meta.changes > 0
}
