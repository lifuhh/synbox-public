// Each song's listens (every visit to its player page counts one; a reload within a minute doesn't) and likes (one per
// account). Listens are public: anyone may add one to a library song (index.ts › refusedSong), so the count is a
// signal, not an audit

const VIDEO_ID = /^[\w-]{11}$/u
// A guest's device: the random id the app keeps in the browser (crypto.randomUUID)
const DEVICE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u

export const isVideoId = (value: string) => VIDEO_ID.test(value)

// Who a listen belongs to: the account when signed in, else the guest's device; null when neither
export const listenerOf = (userId: string | null, device: string | null) => {
  if (userId !== null) {
    return `u:${userId}`
  }
  return device !== null && DEVICE.test(device) ? `d:${device}` : null
}

// A like belongs to an account. Likes from before 2026-10-24 may belong to a guest's device ('d:'); they stay
// stored and count for nothing
export const likerOf = (userId: string) => `u:${userId}`

// An account's every visit to a song counts, leaving and coming back included; a listen this soon after its last
// counted one of the song is the same visit (a reload, a page mounted twice). Replays within a visit send nothing
// (the app's countListen)
export const REPEAT_LISTEN_MS = 60_000
// A guest's device counts one listen per song an hour: guests' plays only feed the numbers
export const GUEST_WINDOW_MS = 3_600_000
// A guest's device id is made by the browser, so a new one costs nothing: past this many guest devices listening to
// one song within GUEST_WINDOW_MS, further guests' listens don't count. A ceiling on scripted inflation, far above
// real traffic (it was 30 when the top song had 22 listens in all, 2026-10-24)
export const GUEST_LISTENS_PER_HOUR = 300

// Whether this listen counts (?1 song, ?2 listener, ?3 now, ?4 1 for a guest): the listener's last counted listen of
// the song is over REPEAT_LISTEN_MS old (GUEST_WINDOW_MS for a guest), and a guest is under the song's hourly guest
// limit
const COUNTS = `
  not exists (select 1 from "songListen" where "videoId" = ?1 and "listener" = ?2
    and "at" > ?3 - (case when ?4 = 1 then ${GUEST_WINDOW_MS} else ${REPEAT_LISTEN_MS} end))
  and (?4 = 0 or (select count(*) from "songListen" where "videoId" = ?1 and "listener" like 'd:%'
    and "at" > ?3 - ${GUEST_WINDOW_MS}) < ${GUEST_LISTENS_PER_HOUR})`

// One batch, so D1 runs it as one transaction: the counts go up only with the listener's row, which is written last
// so the statements before it still see the listen as counting. An account's own play count (accountStats) goes up
// with the song's
export const addListen = async (
  db: D1Database,
  videoId: string,
  listener: string,
  now: number
) => {
  const guest = listener.startsWith('d:') ? 1 : 0
  const statements = [
    db
      .prepare(
        `insert into "songStat" ("videoId", "listens", "lastListenedAt") select ?1, 1, ?3 where ${COUNTS}
         on conflict ("videoId") do update set "listens" = "listens" + 1, "lastListenedAt" = ?3`
      )
      .bind(videoId, listener, now, guest),
  ]
  if (listener.startsWith('u:')) {
    statements.push(
      db
        .prepare(
          `insert into "accountStats" ("userId", "plays", "lastPlayAt") select ?5, 1, ?3 where ${COUNTS}
           on conflict ("userId") do update set "plays" = "plays" + 1, "lastPlayAt" = ?3`
        )
        .bind(videoId, listener, now, guest, listener.slice(2))
    )
  }
  statements.push(
    db
      .prepare(
        `insert into "songListen" ("videoId", "listener", "at") select ?1, ?2, ?3 where ${COUNTS}
         on conflict ("videoId", "listener") do update set "at" = excluded."at"`
      )
      .bind(videoId, listener, now, guest)
  )
  await db.batch(statements)
}

// The daily cron: rows older than the guests' hour decide nothing (the repeat guard needs only a minute)
export const pruneListens = async (db: D1Database, now: number) => {
  await db
    .prepare(`delete from "songListen" where "at" <= ?1`)
    .bind(now - GUEST_WINDOW_MS)
    .run()
}

// The songs anyone played most recently, latest first. Rows from before listens were kept to library songs
// (2026-10-24) may name other videos, so the app keeps only its library's songs from these
export const RECENT_LISTENS = 60
export const listRecentListens = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `select "videoId" from "songStat" where "lastListenedAt" is not null
       order by "lastListenedAt" desc limit ?1`
    )
    .bind(RECENT_LISTENS)
    .all<{ videoId: string }>()
  return results.map((row) => row.videoId)
}

// The listens of every song played at least once, for the counts on song cards (the owner, 2026-10-27: a count
// shows as soon as there is one; it was songs over ten)
export const listListenCounts = async (db: D1Database) => {
  const { results } = await db
    .prepare(`select "videoId", "listens" from "songStat" where "listens" > 0`)
    .all<{ videoId: string; listens: number }>()
  return Object.fromEntries(results.map((row) => [row.videoId, row.listens]))
}

// The listens of the songs asked for, by id, played at least once (a list's own songs, e.g. the chart's karaoke
// ones): one query, at most LISTENS_IDS_MAX ids, D1's limit on bound values
export const LISTENS_IDS_MAX = 100
export const listListensOf = async (db: D1Database, videoIds: string[]) => {
  if (videoIds.length === 0) {
    return {}
  }
  const marks = videoIds.map((_, index) => `?${index + 1}`).join(', ')
  const { results } = await db
    .prepare(
      `select "videoId", "listens" from "songStat" where "listens" > 0 and "videoId" in (${marks})`
    )
    .bind(...videoIds)
    .all<{ videoId: string; listens: number }>()
  return Object.fromEntries(results.map((row) => [row.videoId, row.listens]))
}

export interface SongStats {
  listens: number
  likes: number
  // Whether this account likes the song
  liked: boolean
}

export const readStats = async (
  db: D1Database,
  videoId: string,
  liker: string | null
): Promise<SongStats> => {
  const row = await db
    .prepare(
      `select coalesce((select "listens" from "songStat" where "videoId" = ?1), 0) as "listens",
         (select count(*) from "songLike" where "videoId" = ?1 and "liker" like 'u:%') as "likes",
         exists (select 1 from "songLike" where "videoId" = ?1 and "liker" = ?2) as "liked"`
    )
    .bind(videoId, liker)
    .first<{ listens: number; likes: number; liked: number }>()
  return {
    liked: row?.liked === 1,
    likes: row?.likes ?? 0,
    listens: row?.listens ?? 0,
  }
}

// Liking twice or unliking a song not liked changes nothing
export const setLike = async (
  db: D1Database,
  videoId: string,
  liker: string,
  liked: boolean,
  now: number
) => {
  await (liked
    ? db
        .prepare(
          `insert into "songLike" ("videoId", "liker", "createdAt") values (?1, ?2, ?3)
           on conflict do nothing`
        )
        .bind(videoId, liker, now)
        .run()
    : db
        .prepare(`delete from "songLike" where "videoId" = ?1 and "liker" = ?2`)
        .bind(videoId, liker)
        .run())
}
