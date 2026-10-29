import type { Database } from 'bun:sqlite'
import { beforeEach, expect, test } from 'bun:test'

import {
  DAILY_CAP,
  parseEvents,
  pruneEvents,
  readUsage,
  saveEvents,
} from './events'
import { migratedD1 } from './test-d1'

const one = (name: 'app_open' | 'song_open', at: number) => [
  { at, name, props: {}, videoId: null },
]

let db: D1Database
let sqlite: Database
const now = Date.parse('2026-10-26T10:00:00Z')
const DAY = 86_400_000

beforeEach(() => {
  ;({ db, sqlite } = migratedD1())
})

const actors = () =>
  sqlite
    .query<{ actor: string }, []>(`select "actor" from "event" order by "id"`)
    .all()
    .map((row) => row.actor)

test('only listed names, props and values are kept; one bad prop drops its event', () => {
  const events = parseEvents(
    {
      events: [
        {
          at: now,
          name: 'app_open',
          props: { device: 'phone', surface: 'installed' },
        },
        { at: now, name: 'app_open', props: { device: 'phone', email: 'a@b' } },
        { at: now, name: 'app_open', props: { device: 'fridge' } },
        { at: now, name: 'page_view', props: {} },
        { at: now, name: 'song_open', videoId: 'EaA6NlH80wg' },
        { at: now, name: 'song_open', videoId: 'not a video id' },
        { at: now - 3 * DAY, name: 'installed' },
        {
          at: now,
          name: 'lyrics_feature',
          props: { feature: 'romaji', on: 'true' },
        },
      ],
    },
    now
  )
  expect(events?.map((event) => event.name)).toEqual([
    'app_open',
    'song_open',
    'lyrics_feature',
  ])
  expect(events?.[0]?.props).toEqual({ device: 'phone', surface: 'installed' })
  expect(parseEvents({ events: 'nope' }, now)).toBeNull()
  expect(parseEvents(null, now)).toBeNull()
})

test('an actor stores at most DAILY_CAP events a UTC day; the next day starts again', async () => {
  const batch = Array.from({ length: 50 }, () => ({
    at: now,
    name: 'song_open' as const,
    props: {},
    videoId: null,
  }))
  // Sent one after another, as one browser does
  const stored = await [1, 2, 3, 4, 5, 6, 7, 8].reduce<Promise<number>>(
    async (sum) => (await sum) + (await saveEvents(db, 'd:guest', batch, now)),
    Promise.resolve(0)
  )
  expect(stored).toBe(DAILY_CAP)
  expect(await saveEvents(db, 'u:other', batch, now)).toBe(50)
  expect(await saveEvents(db, 'd:guest', batch, now + DAY)).toBe(50)
})

test('usage counts active people per day, signed in apart, and drops events past 90 days', async () => {
  await saveEvents(db, 'u:a', one('app_open', now), now)
  await saveEvents(db, 'u:a', one('song_open', now), now)
  await saveEvents(db, 'd:g', one('song_open', now), now)
  await saveEvents(db, 'd:g', one('app_open', now - DAY), now)
  await saveEvents(db, 'd:old', one('app_open', now - 100 * DAY), now)
  const usage = await readUsage(db, now, 3)
  expect(
    usage.days.map(({ day, active, signedIn, songOpens }) => ({
      active,
      day,
      signedIn,
      songOpens,
    }))
  ).toEqual([
    { active: 2, day: '2026-10-26', signedIn: 1, songOpens: 2 },
    { active: 1, day: '2026-10-25', signedIn: 0, songOpens: 0 },
    { active: 0, day: '2026-10-24', signedIn: 0, songOpens: 0 },
  ])
  expect(usage.week).toEqual({ active: 2, signedIn: 1 })
  sqlite.run(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role")
     values ('a', 'A', 'a@example.com', 1, ?1, ?1, 'admin')`,
    [now]
  )
  const withoutAdmin = await readUsage(db, now, 3)
  expect(withoutAdmin.days[0]).toMatchObject({
    active: 1,
    signedIn: 0,
    songOpens: 1,
  })
  expect(withoutAdmin.week).toEqual({ active: 1, signedIn: 0 })
  await pruneEvents(db, now)
  expect(actors()).not.toContain('d:old')
  expect(actors()).toHaveLength(4)
})
