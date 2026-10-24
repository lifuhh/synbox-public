// Each song's listens (a visit to its player page counts one, once an hour per listener) and likes (one per
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

// A listener counts one listen per song an hour
export const LISTEN_GAP_MS = 3_600_000
// A guest's device id is made by the browser, so a new one costs nothing: past this many guest listens of one
// song in an hour, further guests' listens don't count (the most played real song had 22 listens in all on
// 2026-10-24)
export const GUEST_LISTENS_PER_HOUR = 30

// Whether this listen counts (?1 song, ?2 listener, ?3 now, ?4 1 for a guest): the listener's last counted listen of
// the song is over an hour old, and a guest is under the song's hourly guest limit
const COUNTS = `
  not exists (select 1 from "songListen" where "videoId" = ?1 and "listener" = ?2 and "at" > ?3 - ${LISTEN_GAP_MS})
  and (?4 = 0 or (select count(*) from "songListen" where "videoId" = ?1 and "listener" like 'd:%'
    and "at" > ?3 - ${LISTEN_GAP_MS}) < ${GUEST_LISTENS_PER_HOUR})`

// One batch, so D1 runs both as one transaction: the count goes up only with the listener's row
export const addListen = async (
  db: D1Database,
  videoId: string,
  listener: string,
  now: number
) => {
  const guest = listener.startsWith('d:') ? 1 : 0
  await db.batch([
    db
      .prepare(
        `insert into "songStat" ("videoId", "listens", "lastListenedAt") select ?1, 1, ?3 where ${COUNTS}
         on conflict ("videoId") do update set "listens" = "listens" + 1, "lastListenedAt" = ?3`
      )
      .bind(videoId, listener, now, guest),
    db
      .prepare(
        `insert into "songListen" ("videoId", "listener", "at") select ?1, ?2, ?3 where ${COUNTS}
         on conflict ("videoId", "listener") do update set "at" = excluded."at"`
      )
      .bind(videoId, listener, now, guest),
  ])
}

// The daily cron: rows past the hour decide nothing
export const pruneListens = async (db: D1Database, now: number) => {
  await db
    .prepare(`delete from "songListen" where "at" <= ?1`)
    .bind(now - LISTEN_GAP_MS)
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

// The listens of every song played more than CARD_LISTENS_MIN times, for the counts on song cards; the songs
// below it show no count, which keeps the answer small as the library grows
export const CARD_LISTENS_MIN = 10
export const listListenCounts = async (db: D1Database) => {
  const { results } = await db
    .prepare(`select "videoId", "listens" from "songStat" where "listens" > ?1`)
    .bind(CARD_LISTENS_MIN)
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
