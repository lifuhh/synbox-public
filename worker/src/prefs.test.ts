import { beforeEach, expect, test } from 'bun:test'

import {
  PREFS_KEYS_LIMIT,
  PREFS_SIZE_LIMIT,
  applyPrefOps,
  parsePrefOps,
  readPrefs,
} from './prefs'
import { migratedD1 } from './test-d1'

let db: D1Database
let sqlite: ReturnType<typeof migratedD1>['sqlite']
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
  const fresh = migratedD1()
  ;({ db, sqlite } = fresh)
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

// `count` song styles already on the account, each a JSON string `size` characters long
const stored = (count: number, size = 3) => {
  const insert = sqlite.prepare(
    `insert into "preference" ("userId", "key", "value", "changedAt") values ('u1', ?, ?, 1)`
  )
  for (let n = 0; n < count; n += 1) {
    insert.run(`lyricsStyle:song${n}`, JSON.stringify('x'.repeat(size - 2)))
  }
}

// One op setting each key
const ops = (...keys: string[]) =>
  parsePrefOps({ ops: keys.map((key) => ({ at: 5, key, value: 'y' })) }, NOW) ??
  []

test('an account at its settings limit gets nothing of a batch that adds a key; changing kept keys still works', async () => {
  stored(PREFS_KEYS_LIMIT - 1)
  // One new key fits; two don't, and the batch's change to a kept key doesn't land either
  expect(await applyPrefOps(db, 'u1', ops('lyricsTheme'))).toBe(true)
  expect(
    await applyPrefOps(db, 'u1', ops('lyricsStyle:song0', 'offlineReader'))
  ).toBe(false)
  const prefs = await readPrefs(db, 'u1')
  expect([Object.keys(prefs).length, prefs['lyricsStyle:song0']?.at]).toEqual([
    PREFS_KEYS_LIMIT,
    1,
  ])
  expect(await applyPrefOps(db, 'u1', ops('lyricsStyle:song0'))).toBe(true)
})

test("an account's settings stay under their size limit", async () => {
  const size = 10_000
  stored(Math.floor(PREFS_SIZE_LIMIT / size), size)
  // A value is stored as JSON: a string two quotes longer
  const big = (key: string) =>
    parsePrefOps({ ops: [{ at: 5, key, value: 'y'.repeat(size - 2) }] }, NOW) ??
    []
  expect(await applyPrefOps(db, 'u1', big('lyricsTemplates'))).toBe(false)
  // Replacing a kept value with one as long fits
  expect(await applyPrefOps(db, 'u1', big('lyricsStyle:song0'))).toBe(true)
  expect(
    await applyPrefOps(
      db,
      'u1',
      parsePrefOps(
        { ops: [{ at: 5, key: 'lyricsStyle:song0', value: null }] },
        NOW
      ) ?? []
    )
  ).toBe(true)
  expect(await applyPrefOps(db, 'u1', big('lyricsTemplates'))).toBe(true)
})
