// A signed-in listener's history, bookmarks and playlists (migrations/0007_library.sql). The app keeps a
// copy on the device and sends each change as an op; every op is last-write-wins on its own timestamp, so
// sending one twice, late, or out of order ends in the same rows.

export interface LibrarySong {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
}

export interface LibraryPlaylist {
  id: string
  name: string
  songs: LibrarySong[]
  createdAt: number
  updatedAt: number
}

export type LibraryOp =
  | { kind: 'play'; song: LibrarySong; at: number }
  | { kind: 'clearHistory'; at: number }
  | { kind: 'bookmark'; song: LibrarySong; saved: boolean; at: number }
  | { kind: 'playlist'; playlist: LibraryPlaylist }
  | { kind: 'deletePlaylist'; id: string; at: number }

export interface Library {
  history: (LibrarySong & { playedAt: number })[]
  bookmarks: LibrarySong[]
  playlists: LibraryPlaylist[]
}

export const HISTORY_LIMIT = 100
export const OPS_LIMIT = 500
const PLAYLIST_SONGS_LIMIT = 1000

type Fields = Record<string, unknown>

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value !== '' && value.length <= max

// Metadata may be blank (YouTube sometimes has no channel name), never missing
const isField = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max

// A device whose clock runs ahead would pin its changes over every later one, so a time is at most now
const timeOf = (value: unknown, now: number) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, now)
    : null

const songOf = (value: unknown): LibrarySong | null => {
  if (!isRecord(value)) {
    return null
  }
  const { videoId, title, author, thumbnailUrl } = value
  return isText(videoId, 64) &&
    isField(title, 300) &&
    isField(author, 300) &&
    isField(thumbnailUrl, 500)
    ? { author, thumbnailUrl, title, videoId }
    : null
}

const playlistOf = (value: unknown, now: number): LibraryPlaylist | null => {
  if (!isRecord(value) || !Array.isArray(value.songs)) {
    return null
  }
  const { id, name } = value
  const createdAt = timeOf(value.createdAt, now)
  const updatedAt = timeOf(value.updatedAt, now)
  const songs = value.songs.map(songOf)
  if (
    !isText(id, 64) ||
    !isText(name, 100) ||
    createdAt === null ||
    updatedAt === null ||
    songs.length > PLAYLIST_SONGS_LIMIT ||
    songs.some((song) => song === null)
  ) {
    return null
  }
  return {
    createdAt,
    id,
    name,
    songs: songs.filter((song) => song !== null),
    updatedAt,
  }
}

const opOf = (value: unknown, now: number): LibraryOp | null => {
  if (!isRecord(value)) {
    return null
  }
  const at = timeOf(value.at, now)
  const song = songOf(value.song)
  if (value.kind === 'playlist') {
    const playlist = playlistOf(value.playlist, now)
    return playlist ? { kind: 'playlist', playlist } : null
  }
  if (at === null) {
    return null
  }
  switch (value.kind) {
    case 'play': {
      return song ? { at, kind: 'play', song } : null
    }
    case 'clearHistory': {
      return { at, kind: 'clearHistory' }
    }
    case 'bookmark': {
      return song && typeof value.saved === 'boolean'
        ? { at, kind: 'bookmark', saved: value.saved, song }
        : null
    }
    case 'deletePlaylist': {
      return isText(value.id, 64)
        ? { at, id: value.id, kind: 'deletePlaylist' }
        : null
    }
    default: {
      return null
    }
  }
}

// The whole request is refused when any op is malformed, so the app never half-applies a batch it sent
export const parseOps = (body: unknown, now: number): LibraryOp[] | null => {
  if (
    !isRecord(body) ||
    !Array.isArray(body.ops) ||
    body.ops.length > OPS_LIMIT
  ) {
    return null
  }
  const ops = body.ops.map((op) => opOf(op, now))
  return ops.every((op) => op !== null) ? ops : null
}

const only = <K extends LibraryOp['kind']>(ops: LibraryOp[], kind: K) =>
  ops.filter((op): op is Extract<LibraryOp, { kind: K }> => op.kind === kind)

// One statement per kind of op, whatever the count (each row goes in as JSON through json_each), so a big
// first sync stays well under D1's per-request query limit
export const applyOps = async (
  db: D1Database,
  userId: string,
  ops: LibraryOp[]
) => {
  const statements: D1PreparedStatement[] = []
  const clears = only(ops, 'clearHistory')
  if (clears.length > 0) {
    const at = Math.max(...clears.map((op) => op.at))
    statements.push(
      db
        .prepare(
          `insert into "libraryState" ("userId", "historyClearedAt") values (?1, ?2)
           on conflict ("userId") do update set "historyClearedAt" = max("historyClearedAt", excluded."historyClearedAt")`
        )
        .bind(userId, at),
      db
        .prepare(
          `delete from "historyEntry" where "userId" = ?1 and "playedAt" <= ?2`
        )
        .bind(userId, at)
    )
  }
  const plays = only(ops, 'play')
  if (plays.length > 0) {
    statements.push(
      db
        .prepare(
          `insert into "historyEntry" ("userId", "videoId", "title", "author", "thumbnailUrl", "playedAt")
           select ?1, json_extract(j.value, '$.videoId'), json_extract(j.value, '$.title'),
             json_extract(j.value, '$.author'), json_extract(j.value, '$.thumbnailUrl'), json_extract(j.value, '$.at')
           from json_each(?2) j
           where json_extract(j.value, '$.at') >
             coalesce((select "historyClearedAt" from "libraryState" where "userId" = ?1), 0)
           on conflict ("userId", "videoId") do update set "title" = excluded."title", "author" = excluded."author",
             "thumbnailUrl" = excluded."thumbnailUrl", "playedAt" = excluded."playedAt"
           where excluded."playedAt" > "historyEntry"."playedAt"`
        )
        .bind(
          userId,
          JSON.stringify(plays.map(({ song, at }) => ({ ...song, at })))
        ),
      db
        .prepare(
          `delete from "historyEntry" where "userId" = ?1 and "videoId" not in
             (select "videoId" from "historyEntry" where "userId" = ?1 order by "playedAt" desc limit ?2)`
        )
        .bind(userId, HISTORY_LIMIT)
    )
  }
  const bookmarks = only(ops, 'bookmark')
  if (bookmarks.length > 0) {
    statements.push(
      db
        .prepare(
          `insert into "bookmark" ("userId", "videoId", "title", "author", "thumbnailUrl", "saved", "changedAt")
           select ?1, json_extract(j.value, '$.videoId'), json_extract(j.value, '$.title'),
             json_extract(j.value, '$.author'), json_extract(j.value, '$.thumbnailUrl'),
             json_extract(j.value, '$.saved'), json_extract(j.value, '$.at')
           from json_each(?2) j where true
           on conflict ("userId", "videoId") do update set "title" = excluded."title", "author" = excluded."author",
             "thumbnailUrl" = excluded."thumbnailUrl", "saved" = excluded."saved", "changedAt" = excluded."changedAt"
           where excluded."changedAt" >= "bookmark"."changedAt"`
        )
        .bind(
          userId,
          JSON.stringify(
            bookmarks.map(({ song, saved, at }) => ({
              ...song,
              at,
              saved: saved ? 1 : 0,
            }))
          )
        )
    )
  }
  const playlists = only(ops, 'playlist')
  if (playlists.length > 0) {
    // A change made after a delete (on a device that hadn't heard of it) brings the playlist back
    statements.push(
      db
        .prepare(
          `insert into "playlist" ("userId", "id", "name", "songs", "createdAt", "updatedAt", "deletedAt")
           select ?1, json_extract(j.value, '$.id'), json_extract(j.value, '$.name'),
             json(json_extract(j.value, '$.songs')), json_extract(j.value, '$.createdAt'),
             json_extract(j.value, '$.updatedAt'), null
           from json_each(?2) j where true
           on conflict ("userId", "id") do update set "name" = excluded."name", "songs" = excluded."songs",
             "updatedAt" = excluded."updatedAt", "deletedAt" = null
           where excluded."updatedAt" > "playlist"."updatedAt"
             and ("playlist"."deletedAt" is null or excluded."updatedAt" > "playlist"."deletedAt")`
        )
        .bind(
          userId,
          JSON.stringify(
            playlists.map(({ playlist }) => ({
              ...playlist,
              songs: JSON.stringify(playlist.songs),
            }))
          )
        )
    )
  }
  const deletes = only(ops, 'deletePlaylist')
  if (deletes.length > 0) {
    statements.push(
      db
        .prepare(
          `insert into "playlist" ("userId", "id", "name", "songs", "createdAt", "updatedAt", "deletedAt")
           select ?1, json_extract(j.value, '$.id'), '', '[]', json_extract(j.value, '$.at'),
             json_extract(j.value, '$.at'), json_extract(j.value, '$.at')
           from json_each(?2) j where true
           on conflict ("userId", "id") do update set "deletedAt" = excluded."deletedAt"
           where excluded."deletedAt" >= "playlist"."updatedAt"
             and ("playlist"."deletedAt" is null or excluded."deletedAt" > "playlist"."deletedAt")`
        )
        .bind(userId, JSON.stringify(deletes.map(({ id, at }) => ({ at, id }))))
    )
  }
  if (statements.length > 0) {
    await db.batch(statements)
  }
}

type PlaylistRow = Omit<LibraryPlaylist, 'songs'> & { songs: string }

export const readLibrary = async (
  db: D1Database,
  userId: string
): Promise<Library> => {
  const [history, bookmarks, playlists] = await Promise.all([
    db
      .prepare(
        `select "videoId", "title", "author", "thumbnailUrl", "playedAt" from "historyEntry"
         where "userId" = ?1 order by "playedAt" desc limit ?2`
      )
      .bind(userId, HISTORY_LIMIT)
      .all<Library['history'][number]>(),
    db
      .prepare(
        `select "videoId", "title", "author", "thumbnailUrl" from "bookmark"
         where "userId" = ?1 and "saved" = 1 order by "changedAt"`
      )
      .bind(userId)
      .all<LibrarySong>(),
    db
      .prepare(
        `select "id", "name", "songs", "createdAt", "updatedAt" from "playlist"
         where "userId" = ?1 and "deletedAt" is null order by "createdAt" desc`
      )
      .bind(userId)
      .all<PlaylistRow>(),
  ])
  return {
    bookmarks: bookmarks.results,
    history: history.results,
    playlists: playlists.results.map((row) => ({
      ...row,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by applyOps from validated songs
      songs: JSON.parse(row.songs) as LibrarySong[],
    })),
  }
}
