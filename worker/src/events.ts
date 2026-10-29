// Usage events the app sends (src/lib/usage.ts): which parts of the app get used, so its owner can see what is
// worth improving. A fixed list of names, each with a fixed set of props and values; anything else is dropped. An
// event belongs to an account, or to a guest's random browser id (songs.ts › listenerOf); never an IP or an email.
// What the server records anyway (listens, generations, reports, accounts) is read from its own tables
// (readUsage), not sent again

const EVENTS = {
  // The app started: installed (home screen) or a browser tab, on a phone, tablet or computer
  app_open: {
    device: ['phone', 'tablet', 'desktop'],
    surface: ['installed', 'web'],
  },
  // Install App pressed: the browser's own prompt, or the steps dialog
  install_prompt: { method: ['prompt', 'guide'] },
  // The browser reported the app installed
  installed: {},
  // A lyrics toggle on the player: shown or hidden ('language' on is English, off Chinese)
  lyrics_feature: {
    feature: ['lyrics', 'romaji', 'translation', 'language'],
    on: ['true', 'false'],
  },
  // A song's link shared or copied
  share: { method: ['sheet', 'copy'] },
  // A song's page opened and counted as a listen (one per visit, src/lib/song-stats.ts › countListen)
  song_open: {},
} as const satisfies Record<string, Record<string, readonly string[]>>

export type EventName = keyof typeof EVENTS

// One request carries at most this many; one actor stores at most this many a UTC day, past which the rest are
// dropped (a real session sends a few dozen)
export const MAX_BATCH = 50
export const DAILY_CAP = 300
// Raw events are kept this long (pruneEvents, the daily cron)
const KEEP_DAYS = 90
const DAY_MS = 86_400_000
const VIDEO_ID = /^[\w-]{11}$/u
// An event stamped this far from the server's clock is dropped: a phone with a wrong clock, or a forged time
const SKEW_MS = DAY_MS

export interface UsageEvent {
  name: EventName
  at: number
  videoId: string | null
  props: Record<string, string>
}

const field = (body: object, key: string): unknown => Reflect.get(body, key)

const isName = (value: unknown): value is EventName =>
  typeof value === 'string' && Object.hasOwn(EVENTS, value)

// The props as sent, if every key belongs to the name and every value is in its list; else null
const parseProps = (
  name: EventName,
  props: unknown
): Record<string, string> | null => {
  if (props === undefined || props === null) {
    return {}
  }
  if (typeof props !== 'object') {
    return null
  }
  const allowed: Record<string, readonly string[]> = EVENTS[name]
  const kept: Record<string, string> = {}
  for (const [key, value] of Object.entries(props)) {
    const values = allowed[key]
    if (
      values === undefined ||
      typeof value !== 'string' ||
      !values.includes(value)
    ) {
      return null
    }
    kept[key] = value
  }
  return kept
}

// One event as sent, or null: an unknown name, a prop the name doesn't take, a value outside its list, a time
// far from now, or a malformed video id
const parseEvent = (raw: unknown, now: number): UsageEvent | null => {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const name = field(raw, 'name')
  const at = field(raw, 'at')
  const videoId = field(raw, 'videoId') ?? null
  if (!isName(name) || typeof at !== 'number' || Math.abs(at - now) > SKEW_MS) {
    return null
  }
  if (
    videoId !== null &&
    (typeof videoId !== 'string' || !VIDEO_ID.test(videoId))
  ) {
    return null
  }
  const props = parseProps(name, field(raw, 'props'))
  return props === null
    ? null
    : {
        at: Math.round(at),
        name,
        props,
        videoId: typeof videoId === 'string' ? videoId : null,
      }
}

// A request's valid events, at most MAX_BATCH; null when the body isn't a list
export const parseEvents = (
  body: unknown,
  now: number
): UsageEvent[] | null => {
  const list =
    typeof body === 'object' && body !== null
      ? field(body, 'events')
      : undefined
  if (!Array.isArray(list)) {
    return null
  }
  return list
    .slice(0, MAX_BATCH)
    .map((raw) => parseEvent(raw, now))
    .filter((event) => event !== null)
}

const dayStart = (now: number) => now - (now % DAY_MS)

// Stores what fits under the actor's daily cap, in one batch; returns how many were stored
export const saveEvents = async (
  db: D1Database,
  actor: string,
  events: UsageEvent[],
  now: number
): Promise<number> => {
  if (events.length === 0) {
    return 0
  }
  const stored = await db
    .prepare(
      `select count(*) as "n" from "event" where "actor" = ?1 and "at" >= ?2`
    )
    .bind(actor, dayStart(now))
    .first<number>('n')
  const kept = events.slice(0, Math.max(0, DAILY_CAP - (stored ?? 0)))
  if (kept.length === 0) {
    return 0
  }
  await db.batch(
    kept.map((event) =>
      db
        .prepare(
          `insert into "event" ("name", "actor", "at", "videoId", "props") values (?1, ?2, ?3, ?4, ?5)`
        )
        .bind(
          event.name,
          actor,
          event.at,
          event.videoId,
          Object.keys(event.props).length === 0
            ? null
            : JSON.stringify(event.props)
        )
    )
  )
  return kept.length
}

export const pruneEvents = async (db: D1Database, now: number) => {
  await db
    .prepare(`delete from "event" where "at" < ?1`)
    .bind(now - KEEP_DAYS * DAY_MS)
    .run()
}

// An admin's own use counts nowhere. New events from an admin are not saved (index.ts › /api/events); this drops the
// ones saved before that, and those of an account made admin later
const NOT_ADMIN = `"actor" not in (select 'u:' || "id" from "user" where "role" = 'admin')`

const dayOf = (column: string) =>
  `strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`

// Days as YYYY-MM-DD (UTC), newest first
const lastDays = (now: number, days: number) =>
  Array.from({ length: days }, (_, i) =>
    new Date(dayStart(now) - i * DAY_MS).toISOString().slice(0, 10)
  )

// Better Auth stores an account's dates as text or a number
const toMs = (value: number | string) =>
  typeof value === 'number' ? value : Date.parse(value)

interface Seen {
  active: number
  signedIn: number
  songOpens: number
}
interface Generated {
  n: number
  failed: number
}

const dayRow = (
  day: string,
  seen: Seen | undefined,
  generated: Generated | undefined,
  newAccounts: number,
  reports: number
) => ({
  active: seen?.active ?? 0,
  day,
  generations: generated?.n ?? 0,
  generationsFailed: generated?.failed ?? 0,
  newAccounts,
  reports,
  signedIn: seen?.signedIn ?? 0,
  songOpens: seen?.songOpens ?? 0,
})

const countByDay = (dates: (number | string)[], from: number) => {
  const counts = new Map<string, number>()
  for (const date of dates) {
    const at = toMs(date)
    if (at >= from) {
      const day = new Date(at).toISOString().slice(0, 10)
      counts.set(day, (counts.get(day) ?? 0) + 1)
    }
  }
  return counts
}

// The admin's Usage tab: the last `days` UTC days, newest first (active people, signed in or not, song opens, new
// accounts, generations started and failed, reports), the past 7 days' totals and each event's count, and the
// most listened songs. Built from the events and the tables the server keeps anyway
export const readUsage = async (db: D1Database, now: number, days = 14) => {
  const from = dayStart(now) - (days - 1) * DAY_MS
  const weekFrom = now - 7 * DAY_MS
  const [activity, accounts, generations, reports, week, events, songs] =
    await Promise.all([
      db
        .prepare(
          `select ${dayOf('"at"')} as "day", count(distinct "actor") as "active",
             count(distinct case when "actor" like 'u:%' then "actor" end) as "signedIn",
             sum(case when "name" = 'song_open' then 1 else 0 end) as "songOpens"
           from "event" where "at" >= ?1 and ${NOT_ADMIN} group by "day"`
        )
        .bind(from)
        .all<Seen & { day: string }>(),
      db
        .prepare(`select "createdAt" from "user"`)
        .all<{ createdAt: number | string }>(),
      db
        .prepare(
          `select ${dayOf('"createdAt"')} as "day", count(*) as "n",
             sum(case when "status" = 'failed' then 1 else 0 end) as "failed"
           from "generation" where "createdAt" >= ?1 group by "day"`
        )
        .bind(from)
        .all<Generated & { day: string }>(),
      db
        .prepare(
          `select ${dayOf('"createdAt"')} as "day", count(*) as "n"
           from "report" where "createdAt" >= ?1 group by "day"`
        )
        .bind(from)
        .all<{ day: string; n: number }>(),
      db
        .prepare(
          `select count(distinct "actor") as "active",
             count(distinct case when "actor" like 'u:%' then "actor" end) as "signedIn"
           from "event" where "at" >= ?1 and ${NOT_ADMIN}`
        )
        .bind(weekFrom)
        .first<{ active: number; signedIn: number }>(),
      db
        .prepare(
          `select "name", count(*) as "count", count(distinct "actor") as "actors"
           from "event" where "at" >= ?1 and ${NOT_ADMIN} group by "name" order by "count" desc`
        )
        .bind(weekFrom)
        .all<{ name: string; count: number; actors: number }>(),
      db
        .prepare(
          `select "videoId", "listens" from "songStat" order by "listens" desc limit 20`
        )
        .all<{ videoId: string; listens: number }>(),
    ])
  const newAccounts = countByDay(
    accounts.results.map((row) => row.createdAt),
    from
  )
  const seen = new Map(activity.results.map((row) => [row.day, row]))
  const generated = new Map(generations.results.map((row) => [row.day, row]))
  const reported = new Map(reports.results.map((row) => [row.day, row.n]))
  return {
    days: lastDays(now, days).map((day) =>
      dayRow(
        day,
        seen.get(day),
        generated.get(day),
        newAccounts.get(day) ?? 0,
        reported.get(day) ?? 0
      )
    ),
    events: events.results,
    songs: songs.results,
    week: { active: week?.active ?? 0, signedIn: week?.signedIn ?? 0 },
  }
}

export type Usage = Awaited<ReturnType<typeof readUsage>>
