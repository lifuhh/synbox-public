// Are the admin Usage tab's people real? Reads production D1's usage events (worker/src/events.ts) and splits each
// day's guests into those who arrived alone and those who arrived in a burst: BURST_SIZE or more new guest browsers
// within BURST_WINDOW_MS of each other. Real visitors arrive one at a time at this site's traffic; a burst is a test
// run on the live site (a release's smoke test opens ~20 fresh browsers in 3 minutes) or a scripted crawl.
//
//   bun harness/usage-audit.ts                 report the last 90 days (read-only)
//   bun harness/usage-audit.ts --purge         also delete the burst guests' events, after saving them to
//                                              docs/private/usage-purge-<time>.json in the main checkout (one per run)
//
// Since 2026-11-13 the Worker stores no event or listen from a driven browser or a crawler (index.ts ›
// automatedClient), so new bursts should not appear; this finds what came before, or anything that slips past.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BURST_SIZE = 5
const BURST_WINDOW_MS = 5 * 60_000

const repo = path.resolve(import.meta.dirname, '..')
const wrangler = path.join(repo, 'worker/node_modules/.bin/wrangler')
const config = path.join(repo, 'worker/wrangler.jsonc')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// The rows of one statement, as wrangler prints them ([{results: [...]}])
const d1 = (sql: string): Record<string, unknown>[] => {
  const run = Bun.spawnSync([
    wrangler,
    'd1',
    'execute',
    'synbox',
    '--remote',
    '--json',
    '-c',
    config,
    '--command',
    sql,
  ])
  if (run.exitCode !== 0) {
    throw new Error(`wrangler failed: ${run.stderr.toString().slice(0, 500)}`)
  }
  const printed: unknown = JSON.parse(run.stdout.toString())
  const results =
    Array.isArray(printed) && isRecord(printed[0]) ? printed[0].results : null
  if (!Array.isArray(results)) {
    throw new TypeError('wrangler printed no results')
  }
  return results.filter(isRecord)
}

interface Arrival {
  actor: string
  first: number
}

// Guests whose first event has BURST_SIZE - 1 other guests' first events within BURST_WINDOW_MS. `sorted`: oldest
// first, as the query orders them
export const burstActors = (sorted: readonly Arrival[]) => {
  const burst = new Set<string>()
  let start = 0
  for (let end = 0; end < sorted.length; end += 1) {
    while (sorted[end].first - sorted[start].first > BURST_WINDOW_MS) {
      start += 1
    }
    if (end - start + 1 >= BURST_SIZE) {
      for (let i = start; i <= end; i += 1) {
        burst.add(sorted[i].actor)
      }
    }
  }
  return burst
}

if (import.meta.main) {
  const purge = process.argv.includes('--purge')
  const arrivals: Arrival[] = d1(
    `select "actor", min("at") as "first" from "event" where "actor" like 'd:%' group by "actor" order by "first"`
  ).flatMap(({ actor, first }) =>
    typeof actor === 'string' && typeof first === 'number'
      ? [{ actor, first }]
      : []
  )
  const burst = burstActors(arrivals)
  const days = new Map<string, { alone: number; burst: number }>()
  for (const { actor, first } of arrivals) {
    const day = new Date(first).toISOString().slice(0, 10)
    const row = days.get(day) ?? { alone: 0, burst: 0 }
    row[burst.has(actor) ? 'burst' : 'alone'] += 1
    days.set(day, row)
  }
  console.log('day (UTC)    guests alone   guests in bursts')
  for (const [day, row] of days) {
    console.log(
      `${day}   ${String(row.alone).padStart(12)}   ${String(row.burst).padStart(16)}`
    )
  }
  console.log(
    `\n${burst.size} of ${arrivals.length} guest browsers arrived in bursts`
  )
  if (purge && burst.size > 0) {
    const list = [...burst].map((actor) => `'${actor.replaceAll("'", '')}'`)
    const rows: Record<string, unknown>[] = []
    // D1 takes a bounded statement; a few hundred ids at a time
    for (let i = 0; i < list.length; i += 200) {
      rows.push(
        ...d1(
          `select * from "event" where "actor" in (${list.slice(i, i + 200).join(',')})`
        )
      )
    }
    const main = path.dirname(
      Bun.spawnSync([
        'git',
        '-C',
        repo,
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ])
        .stdout.toString()
        .trim()
    )
    const dir = path.join(main, 'docs/private')
    mkdirSync(dir, { recursive: true })
    // One file per run, never written over: a second purge the same day once replaced the first one's backup
    const file = path.join(
      dir,
      `usage-purge-${new Date().toISOString().replaceAll(':', '-')}.json`
    )
    writeFileSync(file, JSON.stringify(rows), { flag: 'wx' })
    console.log(`saved ${rows.length} events to ${file}`)
    for (let i = 0; i < list.length; i += 200) {
      d1(
        `delete from "event" where "actor" in (${list.slice(i, i + 200).join(',')})`
      )
    }
    console.log(`deleted the events of ${burst.size} burst guests`)
  }
}
