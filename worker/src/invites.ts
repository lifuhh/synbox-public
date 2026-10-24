// Invites: an account on the default daily limit (USER_DAILY_LIMIT) asks for more, with an optional note, and an
// admin allows it (a quotaOverride of INVITED_DAILY_LIMIT) or dismisses it. An account is invited once it has any
// override, so a limit set by hand on the Accounts tab counts too; admins have no limit and never need one

export const INVITE_NOTE_MAX = 500

export type InviteDecision = 'allowed' | 'dismissed'

export interface InviteStatus {
  invited: boolean
  requested: boolean
}

// The note from a request body ({ note? }); null when it isn't text or runs past INVITE_NOTE_MAX
export const parseInviteNote = (body: unknown): string | null => {
  const note =
    typeof body === 'object' && body !== null && 'note' in body ? body.note : ''
  if (typeof note !== 'string') {
    return null
  }
  const trimmed = note.trim()
  return trimmed.length > INVITE_NOTE_MAX ? null : trimmed
}

export const readInviteStatus = async (
  db: D1Database,
  userId: string,
  role: string
): Promise<InviteStatus> => {
  const row = await db
    .prepare(
      `select exists(select 1 from "quotaOverride" where "userId" = ?1) as "overridden",
         exists(select 1 from "inviteRequest" where "userId" = ?1) as "requested"`
    )
    .bind(userId)
    .first<{ overridden: number; requested: number }>()
  return {
    invited: role === 'admin' || row?.overridden === 1,
    requested: row?.requested === 1,
  }
}

// Asking again changes nothing: the first note stands, and a decided request stays decided
export const requestInvite = async (
  db: D1Database,
  userId: string,
  note: string,
  now: number
) => {
  await db
    .prepare(
      `insert into "inviteRequest" ("userId", "note", "createdAt") values (?1, ?2, ?3)
       on conflict ("userId") do nothing`
    )
    .bind(userId, note, now)
    .run()
}

// Every request, newest first, with who asked and the daily limit they have now ('default' without an override)
export const listInviteRequests = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `select r."userId", r."note", r."status", r."createdAt", r."decidedAt", u."name", u."email", u."image",
         n."note" as "adminNote",
         case when q."userId" is null then 'default' when q."dailyLimit" is null then 'unlimited'
           else q."dailyLimit" end as "dailyLimit"
       from "inviteRequest" r join "user" u on u."id" = r."userId"
       left join "quotaOverride" q on q."userId" = r."userId"
       left join "adminNote" n on n."userId" = r."userId"
       order by r."createdAt" desc limit 500`
    )
    .all()
  return results
}

export const ADMIN_NOTE_MAX = 200

// An admin's note on an account ({ note }); an empty one removes it. False when the body isn't a short text
export const setAdminNote = async (
  db: D1Database,
  userId: string,
  body: unknown,
  { adminId, now }: { adminId: string; now: number }
) => {
  const note =
    typeof body === 'object' && body !== null && 'note' in body
      ? body.note
      : null
  if (typeof note !== 'string' || note.trim().length > ADMIN_NOTE_MAX) {
    return false
  }
  await (
    note.trim() === ''
      ? db.prepare(`delete from "adminNote" where "userId" = ?1`).bind(userId)
      : db
          .prepare(
            `insert into "adminNote" ("userId", "note", "setBy", "setAt") values (?1, ?2, ?3, ?4)
           on conflict ("userId") do update set "note" = ?2, "setBy" = ?3, "setAt" = ?4`
          )
          .bind(userId, note.trim(), adminId, now)
  ).run()
  return true
}

// Allowing sets the account's limit in the same transaction; a limit already set by hand is replaced. False when
// there is no such request
export const decideInvite = async (
  db: D1Database,
  userId: string,
  decision: InviteDecision,
  {
    adminId,
    dailyLimit,
    now,
  }: { adminId: string; dailyLimit: number; now: number }
) => {
  const decide = db
    .prepare(
      `update "inviteRequest" set "status" = ?2, "decidedBy" = ?3, "decidedAt" = ?4 where "userId" = ?1`
    )
    .bind(userId, decision, adminId, now)
  if (decision === 'dismissed') {
    const { meta } = await decide.run()
    return meta.changes > 0
  }
  const found = await db
    .prepare(`select 1 from "inviteRequest" where "userId" = ?1`)
    .bind(userId)
    .first()
  if (found === null) {
    return false
  }
  await db.batch([
    decide,
    db
      .prepare(
        `insert into "quotaOverride" ("userId", "dailyLimit", "setBy", "setAt") values (?1, ?2, ?3, ?4)
         on conflict ("userId") do update set "dailyLimit" = ?2, "setBy" = ?3, "setAt" = ?4`
      )
      .bind(userId, dailyLimit, adminId, now),
  ])
  return true
}
