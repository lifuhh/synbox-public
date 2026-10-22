import { Database } from 'bun:sqlite'
import type { SQLQueryBindings } from 'bun:sqlite'
import { beforeEach, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'

import {
  listRecommendations,
  parseRecommendations,
  replaceRecommendations,
} from './recommendations'
import type { Recommendation } from './recommendations'

interface Statement {
  sql: string
  params: SQLQueryBindings[]
}

// The subset of D1 that recommendations.ts uses, over bun:sqlite with the real migrations; a batch is one
// transaction, as in D1
const asD1 = (sqlite: Database) => {
  const prepare = (sql: string) => {
    const statement: Statement & {
      bind: (...values: SQLQueryBindings[]) => typeof statement
      all: () => Promise<{ results: unknown[] }>
    } = {
      // oxlint-disable-next-line eslint/require-await -- D1's methods are async; bun:sqlite's are not
      async all() {
        return { results: sqlite.query(statement.sql).all(...statement.params) }
      },
      bind(...values) {
        statement.params = values
        return statement
      },
      params: [],
      sql,
    }
    return statement
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the parts of D1 recommendations.ts calls
  return {
    // oxlint-disable-next-line eslint/require-await -- as above
    async batch(statements: Statement[]) {
      sqlite.transaction(() => {
        for (const { sql, params } of statements) {
          sqlite.query(sql).run(...params)
        }
      })()
    },
    prepare,
  } as unknown as D1Database
}

const song = (videoId: string): Recommendation => ({
  author: `Channel ${videoId}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  title: `Song ${videoId}`,
  videoId,
})

let sqlite: Database
let db: D1Database

beforeEach(() => {
  sqlite = new Database(':memory:')
  const dir = `${import.meta.dir}/../migrations`
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .toSorted()) {
    sqlite.run(readFileSync(`${dir}/${file}`, 'utf-8'))
  }
  db = asD1(sqlite)
})

test('the seed is the 32 playlist songs in order; a save replaces the list and keeps when a kept song was added', async () => {
  const seeded = await listRecommendations(db)
  expect(seeded).toHaveLength(32)
  expect(seeded[0].videoId).toBe('Q5JytNgQzqk')
  expect(seeded[31].videoId).toBe('ysdtX8kRTuQ')

  const [, kept] = seeded
  const added = song('AAAAAAAAAAA')
  await replaceRecommendations(db, [added, kept], 'admin-1', 5000)

  expect(await listRecommendations(db)).toEqual([added, kept])
  const rows = sqlite
    .query(
      `select "videoId", "addedBy", "addedAt" from "recommendation" order by "position"`
    )
    .all()
  expect(rows).toEqual([
    { addedAt: 5000, addedBy: 'admin-1', videoId: added.videoId },
    { addedAt: 1_792_627_200_000, addedBy: null, videoId: kept.videoId },
  ])

  await replaceRecommendations(db, [kept, added], 'admin-2', 9000)
  const reordered = await listRecommendations(db)
  expect(reordered.map((recommendation) => recommendation.videoId)).toEqual([
    kept.videoId,
    added.videoId,
  ])
})

test('a save is refused when the list is malformed, empty, too long or repeats a song', () => {
  const ok = song('BBBBBBBBBBB')
  expect(parseRecommendations({ songs: [ok] })).toEqual({
    ok: true,
    songs: [ok],
  })
  expect(parseRecommendations({ songs: [ok, ok] })).toEqual({
    code: 'duplicate',
    ok: false,
  })
  expect(parseRecommendations({ songs: [] })).toEqual({
    code: 'empty',
    ok: false,
  })
  expect(
    parseRecommendations({
      songs: Array.from({ length: 101 }, (_, index) =>
        song(`${index}`.padStart(11, 'x'))
      ),
    })
  ).toEqual({ code: 'too_many', ok: false })
  for (const bad of [
    null,
    { songs: 'nope' },
    { songs: [{ ...ok, videoId: 'short' }] },
    { songs: [{ ...ok, title: '  ' }] },
    { songs: [{ ...ok, thumbnailUrl: 'https://example.com/a.jpg' }] },
    { songs: [{ ...ok, author: undefined }] },
  ]) {
    expect(parseRecommendations(bad)).toEqual({
      code: 'bad_request',
      ok: false,
    })
  }
})
