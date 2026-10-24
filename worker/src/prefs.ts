// A signed-in listener's synced settings (migrations/0009_preference.sql). The app decides which of its
// settings sync and what their values mean; the Worker keeps each one as opaque JSON, last-write-wins on the
// time it changed, so a change sent twice, late, or out of order ends in the same row.

export interface PrefOp {
  key: string
  // JSON text, or null for a setting put back to its default
  value: string | null
  at: number
}

export type Prefs = Record<string, { value: unknown; at: number }>

export const PREF_OPS_LIMIT = 500
// A song's own lyrics style is a few hundred bytes and the saved styles list a few kilobytes
const VALUE_MAX = 16_384
// What one account may keep, counting cleared settings (their rows stay): the app syncs 16 settings plus one
// style per song styled, about 400 characters each, so a style for every library song (195 on 2026-10-24) is
// about 80,000 characters. Both limits are about five times that
export const PREFS_KEYS_LIMIT = 1000
export const PREFS_SIZE_LIMIT = 512_000
const KEY = /^[A-Za-z][\w:-]{0,79}$/u

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// A device whose clock runs ahead would pin its changes over every later one, so a time is at most now
const timeOf = (value: unknown, now: number) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, now)
    : null

const opOf = (value: unknown, now: number): PrefOp | null => {
  if (
    !isRecord(value) ||
    typeof value.key !== 'string' ||
    !KEY.test(value.key)
  ) {
    return null
  }
  const at = timeOf(value.at, now)
  if (at === null || !('value' in value)) {
    return null
  }
  if (value.value === null) {
    return { at, key: value.key, value: null }
  }
  const text = JSON.stringify(value.value)
  return text.length <= VALUE_MAX ? { at, key: value.key, value: text } : null
}

// The whole request is refused when any op is malformed, so the app never half-applies a batch it sent
export const parsePrefOps = (body: unknown, now: number): PrefOp[] | null => {
  if (
    !isRecord(body) ||
    !Array.isArray(body.ops) ||
    body.ops.length > PREF_OPS_LIMIT
  ) {
    return null
  }
  const ops = body.ops.map((op) => opOf(op, now))
  return ops.every((op) => op !== null) ? ops : null
}

// Whether the account stays within its limits with these ops (?2) applied: its other rows plus every key the
// batch names, each counted at the batch's size. Each statement of the write carries it, and D1 runs a batch as
// one transaction, so two requests at once can't both squeeze under it
const WITHIN_LIMITS = `
  (select count(*) from "preference" p where p."userId" = ?1
     and p."key" not in (select json_extract(j.value, '$.key') from json_each(?2) j))
  + (select count(distinct json_extract(j.value, '$.key')) from json_each(?2) j) <= ${PREFS_KEYS_LIMIT}
  and (select coalesce(sum(length(p."value")), 0) from "preference" p where p."userId" = ?1
     and p."key" not in (select json_extract(j.value, '$.key') from json_each(?2) j))
  + (select coalesce(sum(length(json_extract(j.value, '$.value'))), 0) from json_each(?2) j)
  <= ${PREFS_SIZE_LIMIT}`

// One write for the whole batch (rows go in as JSON through json_each). A tie goes to the later write,
// as the library's bookmarks do. false: the account would pass its limits, and nothing was written
export const applyPrefOps = async (
  db: D1Database,
  userId: string,
  ops: PrefOp[]
) => {
  if (ops.length === 0) {
    return true
  }
  const json = JSON.stringify(ops)
  const [verdict] = await db.batch<{ ok: number }>([
    db.prepare(`select (${WITHIN_LIMITS}) as "ok"`).bind(userId, json),
    db
      .prepare(
        `insert into "preference" ("userId", "key", "value", "changedAt")
         select ?1, json_extract(j.value, '$.key'), json_extract(j.value, '$.value'), json_extract(j.value, '$.at')
         from json_each(?2) j where ${WITHIN_LIMITS}
         on conflict ("userId", "key") do update set "value" = excluded."value", "changedAt" = excluded."changedAt"
         where excluded."changedAt" >= "preference"."changedAt"`
      )
      .bind(userId, json),
  ])
  return verdict?.results[0]?.ok === 1
}

export const readPrefs = async (
  db: D1Database,
  userId: string
): Promise<Prefs> => {
  const { results } = await db
    .prepare(
      `select "key", "value", "changedAt" from "preference" where "userId" = ?1`
    )
    .bind(userId)
    .all<{ key: string; value: string | null; changedAt: number }>()
  return Object.fromEntries(
    results.map((row) => [
      row.key,
      {
        at: row.changedAt,
        value: row.value === null ? null : (JSON.parse(row.value) as unknown),
      },
    ])
  )
}
