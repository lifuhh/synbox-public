// The landing page's Recommendations: an ordered list the admin replaces as a whole from the admin page

export interface Recommendation {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
}

export const MAX_RECOMMENDATIONS = 100

export type ParsedRecommendations =
  | { ok: true; songs: Recommendation[] }
  | { ok: false; code: 'bad_request' | 'duplicate' | 'empty' | 'too_many' }

const VIDEO_ID = /^[\w-]{11}$/u
// Every visitor's browser loads these, so only YouTube's own image host
const THUMBNAIL = /^https:\/\/i\.ytimg\.com\/[\w./-]{1,200}$/u

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max

const isRecommendation = (value: unknown): value is Recommendation =>
  typeof value === 'object' &&
  value !== null &&
  'videoId' in value &&
  typeof value.videoId === 'string' &&
  VIDEO_ID.test(value.videoId) &&
  'title' in value &&
  isText(value.title, 300) &&
  'author' in value &&
  isText(value.author, 200) &&
  'thumbnailUrl' in value &&
  typeof value.thumbnailUrl === 'string' &&
  THUMBNAIL.test(value.thumbnailUrl)

// The body of PUT /api/admin/recommendations: { songs: [...] }, in the order to show
export const parseRecommendations = (body: unknown): ParsedRecommendations => {
  const songs =
    typeof body === 'object' && body !== null && 'songs' in body
      ? body.songs
      : undefined
  if (!Array.isArray(songs)) {
    return { code: 'bad_request', ok: false }
  }
  if (songs.length === 0) {
    return { code: 'empty', ok: false }
  }
  if (songs.length > MAX_RECOMMENDATIONS) {
    return { code: 'too_many', ok: false }
  }
  if (!songs.every(isRecommendation)) {
    return { code: 'bad_request', ok: false }
  }
  if (new Set(songs.map((song) => song.videoId)).size !== songs.length) {
    return { code: 'duplicate', ok: false }
  }
  return {
    ok: true,
    songs: songs.map(({ videoId, title, author, thumbnailUrl }) => ({
      author,
      thumbnailUrl,
      title,
      videoId,
    })),
  }
}

export const listRecommendations = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `select "videoId", "title", "author", "thumbnailUrl" from "recommendation" order by "position"`
    )
    .all<Recommendation>()
  return results
}

// Replaces the list in one batch (one transaction). A song that stays keeps who added it and when
export const replaceRecommendations = async (
  db: D1Database,
  songs: Recommendation[],
  adminId: string,
  now = Date.now()
) => {
  await db.batch([
    db
      .prepare(
        `delete from "recommendation" where "videoId" not in (select "value" from json_each(?1))`
      )
      .bind(JSON.stringify(songs.map((song) => song.videoId))),
    ...songs.map((song, position) =>
      db
        .prepare(
          `insert into "recommendation" ("videoId", "title", "author", "thumbnailUrl", "position", "addedBy", "addedAt")
           values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           on conflict ("videoId") do update set "title" = ?2, "author" = ?3, "thumbnailUrl" = ?4, "position" = ?5`
        )
        .bind(
          song.videoId,
          song.title,
          song.author,
          song.thumbnailUrl,
          position,
          adminId,
          now
        )
    ),
  ])
}
