export type GenerationKind = 'new' | 'regenerate' | 'retime'
export type FinishedStatus = 'running' | 'succeeded' | 'failed'

// Who asked: a signed-in user, or a guest known only by a hash of their network. A guest gets one song, ever, by a
// device claim (guest-song.ts)
export type Owner =
  | { kind: 'user'; id: string }
  | { kind: 'guest'; key: string }

export interface Limits {
  // Per signed-in user per day, from their own midnight, unless an admin set an override (a number, or none);
  // admins have none
  user: number
  // Per network in any rolling 24 hours, for its accounts under the default limit together, so a second account on
  // the same network doesn't bring a fresh allowance
  network: number
}

export interface Quota {
  limit: number | null
  used: number
  // The account's next local midnight, when its songs count from zero again
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
        | 'sign_in_required'
        | 'network_limit'
    }

interface UserRow {
  role: string | null
  banned: number | null
  // SQLite's boolean: an admin set this user's limit; then a null dailyLimit means none
  overridden: number
  dailyLimit: number | null
  timeZone: string | null
}

interface GenerationRow {
  userId: string | null
  guestKey: string | null
  videoId: string
  status: 'reserved' | 'running' | 'succeeded' | 'failed'
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10)

export const DAY_MS = 86_400_000
// A generation the backend hasn't reported on for this long has stopped: the app gave up, was put away, or the
// instance running it died. The backend reports every stage and every tenth of one, so a live one never gets here
export const STALL_MS = 15 * 60_000

// How far `zone`'s wall clock is ahead of UTC at `at`, in ms; 0 for a zone Intl doesn't know
const zoneOffset = (zone: string, at: number) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone: zone,
      year: 'numeric',
    }).formatToParts(new Date(at))
    const part = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0)
    const wall = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second')
    )
    return wall - Math.floor(at / 1000) * 1000
  } catch {
    return 0
  }
}

// The UTC instant of the local midnight that starts the wall-clock day `wallMidnight` (a Date.UTC of that date)
const midnightIn = (zone: string, wallMidnight: number) => {
  // Twice, so a midnight on the other side of a daylight-saving change uses its own offset
  const first = wallMidnight - zoneOffset(zone, wallMidnight)
  return wallMidnight - zoneOffset(zone, first)
}

// The day `now` falls in, in `zone` (UTC when null or unknown): when it started and when the next one starts
export const localDay = (zone: string | null, now: Date) => {
  const tz = zone ?? 'UTC'
  const wall = new Date(now.getTime() + zoneOffset(tz, now.getTime()))
  const today = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate()
  )
  return { end: midnightIn(tz, today + DAY_MS), start: midnightIn(tz, today) }
}

// Whether Intl can use `zone`: the app reports the browser's own, but anything can be sent
export const isTimeZone = (zone: unknown): zone is string => {
  if (typeof zone !== 'string' || zone === '' || zone.length > 64) {
    return false
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0)
    return true
  } catch {
    return false
  }
}

export const setTimeZone = async (
  db: D1Database,
  userId: string,
  zone: string,
  now: number
) => {
  await db
    .prepare(
      `insert into "userTimeZone" ("userId", "timeZone", "updatedAt") values (?1, ?2, ?3)
       on conflict ("userId") do update set "timeZone" = ?2, "updatedAt" = ?3`
    )
    .bind(userId, zone, now)
    .run()
}

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
      `select u."role", u."banned", q."userId" is not null as "overridden", q."dailyLimit", z."timeZone"
       from "user" u
       left join "quotaOverride" q on q."userId" = u."id"
       left join "userTimeZone" z on z."userId" = u."id"
       where u."id" = ?1`
    )
    .bind(userId)
    .first<UserRow>()

const limitFor = (user: UserRow, defaultLimit: number) => {
  if (user.role === 'admin') {
    return null
  }
  return user.overridden === 1 ? user.dailyLimit : defaultLimit
}

// A user's songs that count today. ?2 the user, ?9 the start of their day
const COUNTED = `"userId" = ?2 and "createdAt" >= ?9`

// The network's songs in the last 24 hours that count toward its cap. ?10 the network, ?14 a day ago
const NETWORK_COUNT = `(select count(*) from "generation"
    where "networkKey" = ?10 and "capped" = 1 and "createdAt" > ?14 and "status" <> 'failed')`

// Failed generations never count. ?7 the user's limit (null: none), ?10 the caller's network (null: unknown), ?11
// the network's limit, ?13 whether this user is held to it (1: an account under the default limit)
const SLOT_FREE = `(?7 is null or (select count(*) from "generation"
    where ${COUNTED} and "status" <> 'failed') < ?7)
  and (?13 = 0 or ?10 is null or ${NETWORK_COUNT} < ?11)`

const countSince = async (db: D1Database, userId: string, since: number) =>
  (await db
    .prepare(
      `select count(*) from "generation" where "userId" = ?1 and "createdAt" >= ?2 and "status" <> 'failed'`
    )
    .bind(userId, since)
    .first<number>('count(*)')) ?? 0

export const getQuota = async (
  db: D1Database,
  userId: string,
  limits: Limits,
  now = new Date()
): Promise<Quota> => {
  await expireStalled(db, now)
  const user = await readUser(db, userId)
  const day = localDay(user?.timeZone ?? null, now)
  return {
    limit: user ? limitFor(user, limits.user) : 0,
    resetsAt: new Date(day.end).toISOString(),
    used: await countSince(db, userId, day.start),
  }
}

// Whether an owner is held to the shared caps (a guest, or an account under the default limit); null when the
// account is missing or banned. Song checks (validations.ts) use it
export const cappedOwner = async (
  db: D1Database,
  owner: Owner
): Promise<boolean | null> => {
  if (owner.kind === 'guest') {
    return true
  }
  const user = await readUser(db, owner.id)
  if (user === null || user.banned === 1) {
    return null
  }
  return user.role !== 'admin' && user.overridden !== 1
}

interface OwnLimits {
  limit: number | null
  // Counts toward, and is held to, its network's cap
  capped: boolean
  day: { start: number; end: number }
}

const ownLimits = async (
  db: D1Database,
  userId: string,
  limits: Limits,
  now: Date
): Promise<OwnLimits | null> => {
  const user = await readUser(db, userId)
  if (user === null || user.banned === 1) {
    return null
  }
  return {
    capped: user.role !== 'admin' && user.overridden !== 1,
    day: localDay(user.timeZone, now),
    limit: limitFor(user, limits.user),
  }
}

const networkFull = async (
  db: D1Database,
  network: string | null,
  limits: Limits,
  now: Date
) =>
  network !== null &&
  ((await db
    .prepare(
      `select count(*) from "generation"
       where "networkKey" = ?1 and "capped" = 1 and "createdAt" > ?2 and "status" <> 'failed'`
    )
    .bind(network, now.getTime() - DAY_MS)
    .first<number>('count(*)')) ?? 0) >= limits.network

// Why the user was turned away when no slot was free: their own day first, then the shared network cap
const refusal = async (
  db: D1Database,
  userId: string,
  network: string | null,
  own: OwnLimits,
  limits: Limits,
  now: Date
): Promise<Reservation> => {
  const used = await countSince(db, userId, own.day.start)
  if (
    (own.limit === null || used < own.limit) &&
    (await networkFull(db, network, limits, now))
  ) {
    return { outcome: 'network_limit' }
  }
  return {
    limit: own.limit ?? 0,
    outcome: 'quota_exceeded',
    resetsAt: new Date(own.day.end).toISOString(),
  }
}

// A reservation turned away at a limit, kept for the admin page's signals (a check, which takes nothing, is not)
const LIMIT_REFUSALS = new Set<Reservation['outcome']>([
  'quota_exceeded',
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

// The refusals that need no free slot, then the user's limits and the statement bindings for the slot check. A
// guest's one song has its own path (reserveGuest)
type Admitted =
  | { refused: Reservation }
  | { guestKey: string }
  | {
      userId: string
      bindings: (string | number | null)[]
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
  if (request.owner.kind === 'guest') {
    return { guestKey: request.owner.key }
  }
  const userId = request.owner.id
  const own = await ownLimits(db, userId, limits, now)
  if (own === null) {
    return { refused: { outcome: 'forbidden' } }
  }
  const bindings = [
    request.id,
    userId,
    request.videoId,
    request.kind,
    utcDay(now),
    now.getTime(),
    own.limit,
    null,
    own.day.start,
    request.network ?? null,
    limits.network,
    request.client ?? null,
    own.capped ? 1 : 0,
    now.getTime() - DAY_MS,
  ]
  return { bindings, own, userId }
}

// A guest's one song (guest-song.ts): reserved only under the claim the generation proxy took for this generation,
// and held to its network's cap. ?1 the generation, ?2 the guest, ?3 the video, ?4 the kind, ?5 the UTC day, ?6 now,
// ?7 the network (null: unknown), ?8 the client, ?9 a day ago, ?10 the network's limit
const GUEST_SLOT_FREE = `exists (select 1 from "guestSong" where "requestId" = ?1)
  and (?7 is null or (select count(*) from "generation"
    where "networkKey" = ?7 and "capped" = 1 and "createdAt" > ?9 and "status" <> 'failed') < ?10)`

const guestBindings = (
  request: GenerationRequest,
  guestKey: string,
  limits: Limits,
  now: Date
) => [
  request.id,
  guestKey,
  request.videoId,
  request.kind,
  utcDay(now),
  now.getTime(),
  request.network ?? null,
  request.client ?? null,
  now.getTime() - DAY_MS,
  limits.network,
]

// Whether a new song would be reserved, without taking it: the app asks before it starts a generation, so a
// refusal shows at the button instead of partway through. A guest's claim is the proxy's to check
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
  if ('guestKey' in admitted) {
    return (await networkFull(db, request.network ?? null, limits, now))
      ? { outcome: 'network_limit' }
      : { outcome: 'allowed' }
  }
  const { bindings, own, userId } = admitted
  const free = await db
    .prepare(`select ${SLOT_FREE} as "free"`)
    .bind(...bindings)
    .first<number>('free')
  return free === 1
    ? { outcome: 'allowed' }
    : await refusal(db, userId, request.network ?? null, own, limits, now)
}

interface Slot {
  // The owner's column, its value, the statement bindings and the condition a slot must meet
  column: '"userId"' | '"guestKey"'
  owner: string
  bindings: (string | number | null)[]
  free: string
  insertValues: string
  turnedAway: () => Promise<Reservation>
}

// Takes a slot in one statement, so two concurrent requests can't both take the last one (D1 runs writes one at a
// time). The same request id again is a reconnect: it takes nothing more, and a failed one tries again
const takeSlot = async (
  db: D1Database,
  request: GenerationRequest,
  slot: Slot
): Promise<Reservation> => {
  const { meta } = await db
    .prepare(
      `insert into "generation" ("id", ${slot.column}, "videoId", "kind", "status", "utcDay", "createdAt", "updatedAt",
         "networkKey", "client", "capped")
       select ${slot.insertValues} where ${slot.free}
       on conflict ("id") do nothing`
    )
    .bind(...slot.bindings)
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
    return await slot.turnedAway()
  }
  const owner = slot.column === '"userId"' ? existing.userId : existing.guestKey
  // A request id is one song for one owner: never a key to another video, or to a second run once it worked
  if (owner !== slot.owner || existing.videoId !== request.videoId) {
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
       where "id" = ?1 and "status" = 'failed' and ${slot.free}`
    )
    .bind(...slot.bindings)
    .run()
  return retried.meta.changes > 0
    ? { outcome: 'reserved' }
    : await slot.turnedAway()
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
  if ('guestKey' in admitted) {
    const { guestKey } = admitted
    return await takeSlot(db, request, {
      bindings: guestBindings(request, guestKey, limits, now),
      column: '"guestKey"',
      free: GUEST_SLOT_FREE,
      insertValues: `?1, ?2, ?3, ?4, 'reserved', ?5, ?6, ?6, ?7, ?8, 1`,
      owner: guestKey,
      // Without the device's claim, signing in is the way to more songs; with it, the network is full
      turnedAway: async () => {
        const claimed = await db
          .prepare(`select 1 from "guestSong" where "requestId" = ?1`)
          .bind(request.id)
          .first()
        return claimed === null
          ? { outcome: 'sign_in_required' }
          : await recorded(db, request, { outcome: 'network_limit' }, now)
      },
    })
  }
  const { bindings, own, userId } = admitted
  return await takeSlot(db, request, {
    bindings,
    column: '"userId"',
    free: SLOT_FREE,
    insertValues: `?1, ?2, ?3, ?4, 'reserved', ?5, ?6, ?6, ?10, ?12, ?13`,
    owner: userId,
    turnedAway: async () =>
      await recorded(
        db,
        request,
        await refusal(db, userId, request.network ?? null, own, limits, now),
        now
      ),
  })
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
