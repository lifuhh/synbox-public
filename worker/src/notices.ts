// Admins' in-app notices: the latest contact messages, song reports and requests for more songs, each unread when
// it arrived after the admin last opened their notices (adminNoticeSeen). Derived from the rows themselves, so
// there is nothing to keep in step when one is resolved or deleted

export type NoticeKind = 'message' | 'report' | 'request'

export interface Notice {
  kind: NoticeKind
  // The row's own id, as text
  id: string
  at: number
  unread: boolean
  // Who sent it ('' for a guest or a deleted account); the song for a report; a message's subject
  name: string
  videoId: string | null
  subject: string | null
}

const RECENT = 30

export const readNotices = async (
  db: D1Database,
  adminId: string
): Promise<{ notices: Notice[]; unread: number }> => {
  const seenAt =
    (await db
      .prepare(`select "seenAt" from "adminNoticeSeen" where "adminId" = ?1`)
      .bind(adminId)
      .first<number>('seenAt')) ?? 0
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
         union all
         select 'request', cast(q."id" as text), q."createdAt", coalesce(u."name", ''), null, null
         from "quotaRequest" q left join "user" u on u."id" = q."userId"
       ) order by "at" desc limit ?1`
    )
    .bind(RECENT)
    .all<Omit<Notice, 'unread'>>()
  const notices = results.map((row) => ({ ...row, unread: row.at > seenAt }))
  return { notices, unread: notices.filter((n) => n.unread).length }
}

export const markNoticesSeen = async (
  db: D1Database,
  adminId: string,
  now: number
) => {
  await db
    .prepare(
      `insert into "adminNoticeSeen" ("adminId", "seenAt") values (?1, ?2)
       on conflict ("adminId") do update set "seenAt" = ?2`
    )
    .bind(adminId, now)
    .run()
}
