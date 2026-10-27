// Admins' in-app notices: the latest contact messages, song reports, requests for more songs and feedback. A notice
// is unread until the admin opens the bell on it (adminNoticeRead keeps when), and leaves the bell READ_DAYS after
// that, or at Clear Read (adminNoticeSeen.clearedAt). Derived from the rows themselves, so there is nothing to keep in
// step when one is resolved or deleted; /admin lists them all regardless

export type NoticeKind = 'message' | 'report' | 'request' | 'feedback'

export interface Notice {
  kind: NoticeKind
  // The row's own id, as text
  id: string
  at: number
  unread: boolean
  // Who sent it ('' for a guest, anonymous feedback or a deleted account); the song for a report; a message's or
  // feedback's subject
  name: string
  videoId: string | null
  subject: string | null
}

const RECENT = 30
// Rows looked at to fill RECENT once read ones have left
const SCAN = 200
const READ_DAYS = 3
const DAY_MS = 86_400_000

type Row = Omit<Notice, 'unread'>

// An admin's own reports aren't news to them, so they're left out; the fix still reaches them as a reporter (/api/me/fixes)
const recentRows = async (db: D1Database, adminId: string) => {
  const { results } = await db
    .prepare(
      `select * from (
         select 'message' as "kind", cast(m."id" as text) as "id", m."createdAt" as "at",
           coalesce(u."name", '') as "name", null as "videoId", m."subject" as "subject"
         from "contactMessage" m
         left join "user" u on m."sender" like 'u:%' and u."id" = substr(m."sender", 3)
         union all
         select 'report', r."id", r."createdAt", coalesce(u."name", ''), r."videoId", null
         from "report" r left join "user" u on u."id" = r."userId"
         where r."userId" is not ?2
         union all
         select 'request', cast(q."id" as text), q."createdAt", coalesce(u."name", ''), null, null
         from "quotaRequest" q left join "user" u on u."id" = q."userId"
         union all
         select 'feedback', cast(f."id" as text), f."createdAt", coalesce(u."name", ''), null, f."subject"
         from "feedback" f left join "user" u on u."id" = f."userId"
       ) order by "at" desc limit ?1`
    )
    .bind(SCAN, adminId)
    .all<Row>()
  return results
}

const key = (notice: { kind: string; id: string }) =>
  `${notice.kind}:${notice.id}`

// When the admin read each of the rows: its adminNoticeRead row, else, for one that arrived before the admin last
// opened the bell (read before adminNoticeRead existed), when it arrived. Null is unread
const readTimes = async (db: D1Database, adminId: string) => {
  const seen = await db
    .prepare(
      `select "seenAt", "clearedAt" from "adminNoticeSeen" where "adminId" = ?1`
    )
    .bind(adminId)
    .first<{ seenAt: number; clearedAt: number }>()
  const { results } = await db
    .prepare(
      `select "kind", "noticeId" as "id", "readAt" from "adminNoticeRead" where "adminId" = ?1`
    )
    .bind(adminId)
    .all<{ kind: string; id: string; readAt: number }>()
  const read = new Map(results.map((row) => [key(row), row.readAt]))
  const seenAt = seen?.seenAt ?? 0
  return {
    clearedAt: seen?.clearedAt ?? 0,
    readAt: (row: Row) =>
      read.get(key(row)) ?? (row.at <= seenAt ? row.at : null),
  }
}

export const readNotices = async (
  db: D1Database,
  adminId: string,
  now: number
): Promise<{ notices: Notice[]; unread: number; clearable: true }> => {
  const rows = await recentRows(db, adminId)
  const { clearedAt, readAt } = await readTimes(db, adminId)
  const notices = rows
    .flatMap((row) => {
      const at = readAt(row)
      if (
        at !== null &&
        (at < now - READ_DAYS * DAY_MS || row.at <= clearedAt)
      ) {
        return []
      }
      return [{ ...row, unread: at === null }]
    })
    .slice(0, RECENT)
  // `clearable`: this Worker takes POST /notices/clear, so the app may offer Clear Read
  return {
    clearable: true,
    notices,
    unread: notices.filter((n) => n.unread).length,
  }
}

// The admin opened the bell: every notice unread so far is read now
export const markNoticesSeen = async (
  db: D1Database,
  adminId: string,
  now: number
) => {
  const rows = await recentRows(db, adminId)
  const { readAt } = await readTimes(db, adminId)
  const unread = rows.filter((row) => row.at <= now && readAt(row) === null)
  await db.batch([
    ...unread.map((row) =>
      db
        .prepare(
          `insert or ignore into "adminNoticeRead" ("adminId", "kind", "noticeId", "readAt") values (?1, ?2, ?3, ?4)`
        )
        .bind(adminId, row.kind, row.id, now)
    ),
    db
      .prepare(
        `insert into "adminNoticeSeen" ("adminId", "seenAt") values (?1, ?2)
         on conflict ("adminId") do update set "seenAt" = ?2`
      )
      .bind(adminId, now),
  ])
}

// Clear Read: what the admin has read so far leaves the bell; anything unread stays
export const clearReadNotices = async (
  db: D1Database,
  adminId: string,
  now: number
) => {
  const rows = await recentRows(db, adminId)
  const { readAt } = await readTimes(db, adminId)
  // Up to the oldest notice still unread, so clearing never takes one the admin hasn't seen
  const unread = rows.filter((row) => readAt(row) === null).map((row) => row.at)
  const upTo = Math.min(now, ...unread.map((at) => at - 1))
  await db
    .prepare(
      `insert into "adminNoticeSeen" ("adminId", "seenAt", "clearedAt") values (?1, 0, ?2)
       on conflict ("adminId") do update set "clearedAt" = max("clearedAt", ?2)`
    )
    .bind(adminId, upTo)
    .run()
}

// The daily cron: a read row past READ_DAYS hides nothing its fallback (read when it arrived) wouldn't
export const pruneNoticeReads = async (db: D1Database, now: number) => {
  await db
    .prepare(`delete from "adminNoticeRead" where "readAt" < ?1`)
    .bind(now - READ_DAYS * DAY_MS)
    .run()
}
