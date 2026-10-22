import type { ListSong, Playlist } from '@/lib/listening/model'

// A listener's history, bookmarks and playlists. On this device they live in local storage; for a signed-in
// listener every change is also an op sent to the account (worker/src/library.ts), which applies it
// last-write-wins on `at`, so the device and the account converge whatever order the ops arrive in.
export interface HistoryItem extends ListSong {
  timestamp: number
}

export interface Library {
  history: HistoryItem[]
  bookmarks: ListSong[]
  playlists: Playlist[]
}

export type LibraryOp =
  | { kind: 'play'; song: ListSong; at: number }
  | { kind: 'clearHistory'; at: number }
  | { kind: 'bookmark'; song: ListSong; saved: boolean; at: number }
  | { kind: 'playlist'; playlist: Playlist }
  | { kind: 'deletePlaylist'; id: string; at: number }

export const HISTORY_LIMIT = 100

export const emptyLibrary: Library = {
  bookmarks: [],
  history: [],
  playlists: [],
}

// Only what the account stores, so a song from a richer list (a search result) sends nothing extra
const songOf = ({ author, thumbnailUrl, title, videoId }: ListSong) => ({
  author,
  thumbnailUrl,
  title,
  videoId,
})

const newestFirst = (a: HistoryItem, b: HistoryItem) =>
  b.timestamp - a.timestamp

export const applyOp = (library: Library, op: LibraryOp): Library => {
  switch (op.kind) {
    case 'play': {
      const played = library.history.find(
        (item) => item.videoId === op.song.videoId
      )
      if (played !== undefined && played.timestamp >= op.at) {
        return library
      }
      const history = [
        { ...songOf(op.song), timestamp: op.at },
        ...library.history.filter((item) => item.videoId !== op.song.videoId),
      ]
        .toSorted(newestFirst)
        .slice(0, HISTORY_LIMIT)
      return { ...library, history }
    }
    case 'clearHistory': {
      return {
        ...library,
        history: library.history.filter((item) => item.timestamp > op.at),
      }
    }
    case 'bookmark': {
      const others = library.bookmarks.filter(
        (song) => song.videoId !== op.song.videoId
      )
      if (!op.saved) {
        return { ...library, bookmarks: others }
      }
      return others.length < library.bookmarks.length
        ? library
        : { ...library, bookmarks: [...library.bookmarks, songOf(op.song)] }
    }
    case 'playlist': {
      const saved = library.playlists.find((list) => list.id === op.playlist.id)
      if (saved !== undefined && saved.updatedAt > op.playlist.updatedAt) {
        return library
      }
      // Newest first, the account's order, so an undone delete goes back where it was
      const playlists = [
        op.playlist,
        ...library.playlists.filter((list) => list.id !== op.playlist.id),
      ].toSorted((a, b) => b.createdAt - a.createdAt)
      return { ...library, playlists }
    }
    case 'deletePlaylist': {
      return {
        ...library,
        playlists: library.playlists.filter((list) => list.id !== op.id),
      }
    }
    default: {
      return library
    }
  }
}

// What a guest's library on this device becomes when they sign in: ops that merge it into the account.
// Bookmarks have no time of their own, so they take times just before now, in their order
export const libraryOps = (library: Library, now: number): LibraryOp[] => [
  ...library.history.map((item): LibraryOp => ({
    at: item.timestamp,
    kind: 'play',
    song: item,
  })),
  ...library.bookmarks.map((song, index): LibraryOp => ({
    at: now - library.bookmarks.length + index,
    kind: 'bookmark',
    saved: true,
    song,
  })),
  ...library.playlists.map((playlist): LibraryOp => ({
    kind: 'playlist',
    playlist,
  })),
]
