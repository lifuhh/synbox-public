// Each song's listens (a visit to its player page counts one) and likes (one per account, or per device for a
// guest). Public: anyone may add a listen or like, so the counts are a signal, not an audit

const VIDEO_ID = /^[\w-]{11}$/u
// A guest's device: the random id the app keeps in the browser (crypto.randomUUID)
const DEVICE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u

export const isVideoId = (value: string) => VIDEO_ID.test(value)

// Who a like belongs to: the account when signed in, else the guest's device; null when neither
export const likerOf = (userId: string | null, device: string | null) => {
  if (userId !== null) {
    return `u:${userId}`
  }
  return device !== null && DEVICE.test(device) ? `d:${device}` : null
}

export const addListen = async (
  db: D1Database,
  videoId: string,
  now: number
) => {
  await db
    .prepare(
      `insert into "songStat" ("videoId", "listens", "lastListenedAt") values (?1, 1, ?2)
       on conflict ("videoId") do update set "listens" = "listens" + 1, "lastListenedAt" = ?2`
    )
    .bind(videoId, now)
    .run()
}

// The songs anyone played most recently, latest first. Any video id can be sent a listen, so the app keeps only
// its library's songs from these
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

export interface SongStats {
  listens: number
  likes: number
  // Whether this account or device likes the song
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
         (select count(*) from "songLike" where "videoId" = ?1) as "likes",
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
