// Delete on /admin is soft: a row gets "deletedAt" (migration 0033) and leaves every admin list, count and notice,
// and Undo clears it again. A closed report is deleted by reports.ts › deleteReport (an open one can't be); a
// feedback and a contact message by deleteRow, whatever their state

const TABLES = {
  feedback: 'feedback',
  message: 'contactMessage',
  report: 'report',
} as const
export type DeletedKind = keyof typeof TABLES

// One Undo carries at most this many (Clear All's): far more dropped reports than ever pile up
export const RESTORE_MAX = 10_000

export const deleteRow = async (
  db: D1Database,
  kind: 'feedback' | 'message',
  id: number,
  now: number
) => {
  const { meta } = await db
    .prepare(
      `update "${TABLES[kind]}" set "deletedAt" = ?2 where "id" = ?1 and "deletedAt" is null`
    )
    .bind(id, now)
    .run()
  return meta.changes > 0
}

// Undo: the rows come back as they were when deleted
export const restoreRows = async (
  db: D1Database,
  kind: DeletedKind,
  ids: readonly (string | number)[]
) => {
  await db
    .prepare(
      `update "${TABLES[kind]}" set "deletedAt" = null
       where "deletedAt" is not null and "id" in (select "value" from json_each(?1))`
    )
    .bind(JSON.stringify(ids))
    .run()
}

// The body of POST /api/admin/{reports,feedback,messages}/restore: { ids }, report ids text and the others
// numbers, or null when it is off
export const parseRestore = (
  body: unknown,
  kind: DeletedKind
): (string | number)[] | null => {
  const given: unknown =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'ids') : null
  if (!Array.isArray(given)) {
    return null
  }
  const ids = given.filter((id: unknown): id is string | number =>
    kind === 'report'
      ? typeof id === 'string' && id !== ''
      : Number.isInteger(id)
  )
  return ids.length === 0 ||
    ids.length !== given.length ||
    ids.length > RESTORE_MAX
    ? null
    : ids
}
