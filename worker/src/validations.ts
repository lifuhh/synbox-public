import { DAY_MS, ownLimits } from './quota'
import type { Limits, Owner } from './quota'

// Song checks (the backend's /validate, which downloads the song) per rolling 24 hours, for the owners songs are
// capped for: a guest, or an account under the default limit. Admins and accounts with an override have none
export interface ValidationLimits {
  user: number
  guest: number
  // Guests and capped accounts on one network together
  network: number
}

export interface Counted {
  outcome: 'counted' | 'replay' | 'validation_limit' | 'forbidden'
}

interface ValidationRequest {
  // The backend's id for this check, so asking again after a dropped connection counts it once
  id: string
  owner: Owner
  videoId: string
  // The backend's keyed hash of the caller's network, and the caller's user agent; null when not sent
  network: string | null
  client: string | null
}

// The owner column is one of two literals, never input. ?2 owner, ?3 network, ?4 capped (1 or 0), ?6 now,
// ?7 a day ago, ?8 the owner's cap, ?9 the network's cap
const COLUMN = { guest: '"guestKey"', user: '"userId"' } as const

const slotFree = (column: string) => `(?4 = 0 or (
    (select count(*) from "validation" where ${column} = ?2 and "createdAt" > ?7) < ?8
    and (?3 is null or (select count(*) from "validation"
      where "networkKey" = ?3 and "capped" = 1 and "createdAt" > ?7) < ?9)))`

// Counts one check against its owner and network, or refuses it past either cap
export const countValidation = async (
  db: D1Database,
  request: ValidationRequest,
  limits: Limits,
  validationLimits: ValidationLimits,
  now = new Date()
): Promise<Counted> => {
  const { owner } = request
  const own = await ownLimits(db, owner, limits)
  if (own === null) {
    return { outcome: 'forbidden' }
  }
  const column = COLUMN[owner.kind]
  const value = owner.kind === 'user' ? owner.id : owner.key
  // One statement, so two concurrent checks can't both take the last slot (D1 runs writes one at a time)
  const { meta } = await db
    .prepare(
      `insert into "validation" ("id", ${column}, "networkKey", "capped", "videoId", "createdAt")
       select ?1, ?2, ?3, ?4, ?5, ?6 where ${slotFree(column)}
       on conflict ("id") do nothing`
    )
    .bind(
      request.id,
      value,
      request.network,
      own.capped ? 1 : 0,
      request.videoId,
      now.getTime(),
      now.getTime() - DAY_MS,
      owner.kind === 'user' ? validationLimits.user : validationLimits.guest,
      validationLimits.network
    )
    .run()
  if (meta.changes > 0) {
    return { outcome: 'counted' }
  }
  const existing = await db
    .prepare(
      `select ${column} as "owner", "videoId" from "validation" where "id" = ?1`
    )
    .bind(request.id)
    .first<{ owner: string | null; videoId: string }>()
  if (existing !== null) {
    return existing.owner === value && existing.videoId === request.videoId
      ? { outcome: 'replay' }
      : { outcome: 'forbidden' }
  }
  // Kept for the admin page's signals, like a song refused at a limit
  await db
    .prepare(
      `insert into "refusal" ("code", "userId", "guestKey", "networkKey", "client", "createdAt")
       values ('validation_limit', ?1, ?2, ?3, ?4, ?5)`
    )
    .bind(
      owner.kind === 'user' ? owner.id : null,
      owner.kind === 'guest' ? owner.key : null,
      request.network,
      request.client,
      now.getTime()
    )
    .run()
  return { outcome: 'validation_limit' }
}

// Rows past their 24 hours count toward nothing
export const pruneValidations = async (db: D1Database, now: number) => {
  await db
    .prepare(`delete from "validation" where "createdAt" <= ?1`)
    .bind(now - DAY_MS)
    .run()
}
