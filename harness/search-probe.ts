// What the live Search page finds for a query: the library search's songs that have karaoke, counted the way
// search-page.tsx › SearchResults shows them. Read-only. Use it to prove a suggestion pill still finds songs.
//
//   bun harness/search-probe.ts "<query>" [...]   one or more queries
//   bun harness/search-probe.ts --examples        the Search page's suggestion pills (search-examples.ts)
//
// Prints per query: karaoke results, the search's mode, and the first titles.

import { SEARCH_EXAMPLES } from '../src/_root/pages/search-examples'

const SITE = 'https://synbox.io'
const LOOKUP = 'https://synbox-lookup-1045990822048.asia-southeast1.run.app'
const SHOWN = 6

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

// The rows of `key` in a JSON body that carry a string video_id
const rows = (body: unknown, key: string): Record<string, unknown>[] =>
  isRecord(body) && Array.isArray(body[key])
    ? body[key].filter(
        (row): row is Record<string, unknown> =>
          isRecord(row) && typeof row.video_id === 'string'
      )
    : []

const karaokeIds = async () => {
  const response = await fetch(`${SITE}/api/library/songs`)
  const songs = rows(await response.json(), 'songs')
  return new Set(
    songs.filter((song) => song.karaoke === true).map((song) => song.video_id)
  )
}

const probe = async (query: string, karaoke: Set<unknown>) => {
  const response = await fetch(
    `${LOOKUP}/library/search?q=${encodeURIComponent(query)}`
  )
  const body: unknown = await response.json()
  const mode = isRecord(body) && typeof body.mode === 'string' ? body.mode : '?'
  const found = rows(body, 'results').filter((song) =>
    karaoke.has(song.video_id)
  )
  return [
    `${String(found.length).padStart(3)}  ${query}  (${mode})`,
    ...found.slice(0, SHOWN).map((song) => `       ${String(song.title)}`),
  ].join('\n')
}

const args = process.argv.slice(2)
const queries = args.includes('--examples') ? [...SEARCH_EXAMPLES] : args
if (queries.length === 0) {
  console.error(
    'Usage: bun harness/search-probe.ts "<query>" [...] | --examples'
  )
  process.exit(1)
}
const karaoke = await karaokeIds()
for (const report of await Promise.all(
  queries.map(async (query) => await probe(query, karaoke))
)) {
  console.log(report)
}
