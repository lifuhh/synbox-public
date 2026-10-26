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

interface LibrarySong {
  video_id: string
  karaoke: boolean
}
interface SearchResult {
  video_id: string
  title: string
}

const karaokeIds = async () => {
  const response = await fetch(`${SITE}/api/library/songs`)
  const { songs } = (await response.json()) as { songs: LibrarySong[] }
  return new Set(
    songs.filter((song) => song.karaoke).map((song) => song.video_id)
  )
}

const probe = async (query: string, karaoke: Set<string>) => {
  const response = await fetch(
    `${LOOKUP}/library/search?q=${encodeURIComponent(query)}`
  )
  const body = (await response.json()) as {
    mode?: string
    results?: SearchResult[]
  }
  const found = (body.results ?? []).filter((song) =>
    karaoke.has(song.video_id)
  )
  console.log(
    `${String(found.length).padStart(3)}  ${query}  (${body.mode ?? '?'})`
  )
  for (const song of found.slice(0, SHOWN)) {
    console.log(`       ${song.title}`)
  }
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
for (const query of queries) {
  await probe(query, karaoke)
}
