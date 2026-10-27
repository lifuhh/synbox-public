// "Can I add more songs a day": an account sends a short note about itself; an admin approves it with a number of
// songs a day (written to quotaOverride in the same batch) or declines it. One open request per account; after a
// decision the account can ask again

export const REQUEST_NOTE_MAX = 600

export type RequestStatus = 'open' | 'approved' | 'declined'

export interface RequestView {
  status: RequestStatus
  createdAt: number
  decidedAt: number | null
  granted: number | null
}

// The note from a request body ({ note }); null when it isn't text, is empty, or runs past REQUEST_NOTE_MAX
export const parseRequestNote = (body: unknown): string | null => {
  const note =
    typeof body === 'object' && body !== null && 'note' in body
      ? body.note
      : null
  if (typeof note !== 'string') {
    return null
  }
  const trimmed = note.trim()
  return trimmed === '' || trimmed.length > REQUEST_NOTE_MAX ? null : trimmed
}

// The account's latest request, or null when it never asked
export const latestRequest = async (
  db: D1Database,
  userId: string
): Promise<RequestView | null> =>
  await db
    .prepare(
      `select "status", "createdAt", "decidedAt", "granted" from "quotaRequest"
       where "userId" = ?1 order by "createdAt" desc, "id" desc limit 1`
    )
    .bind(userId)
    .first<RequestView>()

// False while the account already has an open request (the unique index on open requests refuses the second)
export const sendRequest = async (
  db: D1Database,
  userId: string,
  note: string,
  now: number
) => {
  const { meta } = await db
    .prepare(
      `insert into "quotaRequest" ("userId", "note", "status", "createdAt") values (?1, ?2, 'open', ?3)
       on conflict do nothing`
    )
    .bind(userId, note, now)
    .run()
  return meta.changes > 0
}

// Every request, open ones first, then newest first, with who asked and the daily songs they have now
// ('default' without an override, 'unlimited' for a null one)
export const listRequests = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `select r."id", r."userId", r."note", r."status", r."createdAt", r."decidedAt", r."granted",
         u."name", u."email", u."image",
         case when q."userId" is null then 'default' when q."dailyLimit" is null then 'unlimited'
           else q."dailyLimit" end as "dailyLimit"
       from "quotaRequest" r join "user" u on u."id" = r."userId"
       left join "quotaOverride" q on q."userId" = r."userId"
       order by r."status" = 'open' desc, r."createdAt" desc limit 300`
    )
    .all()
  return results
}

// Approving gives the account `dailyLimit` songs a day; declining changes nothing else. False when the request
// isn't open (already decided, or no such request)
export const decideRequest = async (
  db: D1Database,
  id: number,
  decision: { approve: true; dailyLimit: number } | { approve: false },
  { adminId, now }: { adminId: string; now: number }
) => {
  const open = await db
    .prepare(
      `select "userId" from "quotaRequest" where "id" = ?1 and "status" = 'open'`
    )
    .bind(id)
    .first<string>('userId')
  if (open === null) {
    return false
  }
  const decide = db
    .prepare(
      `update "quotaRequest" set "status" = ?2, "decidedAt" = ?3, "decidedBy" = ?4, "granted" = ?5
       where "id" = ?1 and "status" = 'open'`
    )
    .bind(
      id,
      decision.approve ? 'approved' : 'declined',
      now,
      adminId,
      decision.approve ? decision.dailyLimit : null
    )
  if (!decision.approve) {
    await decide.run()
    return true
  }
  await db.batch([
    decide,
    db
      .prepare(
        `insert into "quotaOverride" ("userId", "dailyLimit", "setBy", "setAt") values (?1, ?2, ?3, ?4)
         on conflict ("userId") do update set "dailyLimit" = ?2, "setBy" = ?3, "setAt" = ?4`
      )
      .bind(open, decision.dailyLimit, adminId, now),
  ])
  return true
}
