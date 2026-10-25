// When each signed-in account last used the app, for /admin › Accounts. Written at most once per ACTIVE_GAP_MS per
// account: within the gap the upsert's condition fails and D1 writes no row
export const ACTIVE_GAP_MS = 600_000

export const touchActive = async (
  db: D1Database,
  userId: string,
  now: number
) => {
  await db
    .prepare(
      `insert into "accountStats" ("userId", "lastActiveAt") values (?1, ?2)
       on conflict ("userId") do update set "lastActiveAt" = excluded."lastActiveAt"
       where "accountStats"."lastActiveAt" is null or "accountStats"."lastActiveAt" <= ?2 - ${ACTIVE_GAP_MS}`
    )
    .bind(userId, now)
    .run()
}
