import { beforeEach, expect, test } from 'bun:test'

import { applyPrefOps, parsePrefOps, readPrefs } from './prefs'
import { migratedD1 } from './test-d1'

let db: D1Database
const NOW = 1_000_000

const sync = async (...ops: unknown[]) => {
  const parsed = parsePrefOps({ ops }, NOW)
  if (parsed === null) {
    throw new Error('refused')
  }
  await applyPrefOps(db, 'u1', parsed)
  return await readPrefs(db, 'u1')
}

beforeEach(() => {
  const { db: fresh, sqlite } = migratedD1()
  db = fresh
  sqlite
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (?, 'n', ?, 1, 0, 0)`
    )
    .run('u1', 'a@x')
})

test('each setting keeps its newest value, so devices changing different settings never undo each other', async () => {
  await sync({ at: 20, key: 'lyricsTheme', value: 'aqua' })
  // A phone changes the size later, and a laptop's older theme change arrives late
  const prefs = await sync(
    { at: 30, key: 'fontSizeMultiplier', value: 1.2 },
    { at: 10, key: 'lyricsTheme', value: 'sakura' }
  )
  expect(prefs).toEqual({
    fontSizeMultiplier: { at: 30, value: 1.2 },
    lyricsTheme: { at: 20, value: 'aqua' },
  })
})

test("a cleared song style stays cleared when another device's older copy arrives", async () => {
  const style = { fontSize: 1.3, themeId: 'matcha' }
  await sync({ at: 10, key: 'lyricsStyle:abcdefghijk', value: style })
  await sync({ at: 20, key: 'lyricsStyle:abcdefghijk', value: null })
  const prefs = await sync({
    at: 15,
    key: 'lyricsStyle:abcdefghijk',
    value: style,
  })
  expect(prefs['lyricsStyle:abcdefghijk']).toEqual({ at: 20, value: null })
})

test('objects and lists come back as they were sent', async () => {
  const templates = {
    templates: [{ name: 'Night', style: { themeId: 'aqua' } }],
    v: 1,
  }
  const prefs = await sync({ at: 5, key: 'lyricsTemplates', value: templates })
  expect(prefs.lyricsTemplates).toEqual({ at: 5, value: templates })
})

test('a batch with any malformed op is refused whole, and a time ahead of the server is pulled back to now', () => {
  expect(
    parsePrefOps({ ops: [{ at: 1, key: 'a b', value: 1 }] }, NOW)
  ).toBeNull()
  expect(parsePrefOps({ ops: [{ at: 1, key: 'ok' }] }, NOW)).toBeNull()
  expect(
    parsePrefOps(
      { ops: [{ at: 1, key: 'big', value: 'x'.repeat(20_000) }] },
      NOW
    )
  ).toBeNull()
  expect(
    parsePrefOps({ ops: [{ at: NOW * 2, key: 'ok', value: true }] }, NOW)
  ).toEqual([{ at: NOW, key: 'ok', value: 'true' }])
})
