export type GenerationKind = 'new' | 'regenerate' | 'retime'
export type FinishedStatus = 'running' | 'succeeded' | 'failed'

export interface Quota {
  limit: number | null
  used: number
  resetsAt: string
}

export type Reservation =
  | { outcome: 'reserved' | 'replay' }
  | { outcome: 'quota_exceeded'; limit: number; resetsAt: string }
  | { outcome: 'generation_paused' | 'forbidden' | 'already_finished' }

interface GenerationRow {
  userId: string
  videoId: string
  status: 'reserved' | 'running' | 'succeeded' | 'failed'
}

interface UserRow {
  role: string | null
  banned: number | null
  dailyLimit: number | null
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10)

const nextUtcMidnight = (now: Date) =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString()

// Failed generations never count against the user
const COUNT_TODAY = `select count(*) from "generation" where "userId" = ?1 and "utcDay" = ?2 and "status" <> 'failed'`

const readUser = async (db: D1Database, userId: string) =>
  await db
    .prepare(
      `select u."role", u."banned", q."dailyLimit" from "user" u
       left join "quotaOverride" q on q."userId" = u."id" where u."id" = ?1`
    )
    .bind(userId)
    .first<UserRow>()

const limitFor = (user: UserRow, defaultLimit: number) =>
  user.role === 'admin' ? null : (user.dailyLimit ?? defaultLimit)

export const getQuota = async (
  db: D1Database,
  userId: string,
  defaultLimit: number,
  now = new Date()
): Promise<Quota> => {
  const user = await readUser(db, userId)
  const used = await db
    .prepare(COUNT_TODAY)
    .bind(userId, utcDay(now))
    .first<number>('count(*)')
  return {
    limit: user ? limitFor(user, defaultLimit) : 0,
    resetsAt: nextUtcMidnight(now),
    used: used ?? 0,
  }
}

export const reserveGeneration = async (
  db: D1Database,
  request: {
    id: string
    userId: string
    videoId: string
    kind: GenerationKind
  },
  defaultLimit: number,
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
  const user = await readUser(db, request.userId)
  if (user === null || user.banned === 1) {
    return { outcome: 'forbidden' }
  }
  const limit = limitFor(user, defaultLimit)
  const day = utcDay(now)
  // One statement, so two concurrent requests can't both take the last slot (D1 runs writes one at a time)
  const { meta } = await db
    .prepare(
      `insert into "generation" ("id", "userId", "videoId", "kind", "status", "utcDay", "createdAt")
       select ?1, ?2, ?3, ?4, 'reserved', ?5, ?6
       where ?7 is null or (select count(*) from "generation"
         where "userId" = ?2 and "utcDay" = ?5 and "status" <> 'failed') < ?7
       on conflict ("id") do nothing`
    )
    .bind(
      request.id,
      request.userId,
      request.videoId,
      request.kind,
      day,
      now.getTime(),
      limit
    )
    .run()
  if (meta.changes > 0) {
    return { outcome: 'reserved' }
  }
  const exceeded = {
    limit: limit ?? 0,
    outcome: 'quota_exceeded',
    resetsAt: nextUtcMidnight(now),
  } as const
  const existing = await db
    .prepare(
      `select "userId", "videoId", "status" from "generation" where "id" = ?1`
    )
    .bind(request.id)
    .first<GenerationRow>()
  if (existing === null) {
    return exceeded
  }
  // A request id is one song for one user: never a key to another video, or to a second run once it worked
  if (
    existing.userId !== request.userId ||
    existing.videoId !== request.videoId
  ) {
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
       where "id" = ?1 and "status" = 'failed' and (?3 is null or (select count(*) from "generation"
         where "userId" = ?2 and "utcDay" = ?4 and "status" <> 'failed') < ?3)`
    )
    .bind(request.id, request.userId, limit, day)
    .run()
  return retried.meta.changes > 0 ? { outcome: 'reserved' } : exceeded
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
