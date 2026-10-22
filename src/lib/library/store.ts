import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

import type { ListSong, Playlist } from '@/lib/listening/model'

import type { HistoryItem, Library, LibraryOp } from './model'
import { applyOp } from './model'

// This device's copy of the library, under the keys it always had, so nothing on a device is lost. Read on
// init: sync.tsx reads them through the store before any component has subscribed to them
const initOptions = { getOnInit: true }
export const historyAtom = atomWithStorage<HistoryItem[]>(
  'history',
  [],
  undefined,
  initOptions
)
export const favoritesAtom = atomWithStorage<ListSong[]>(
  'favorites',
  [],
  undefined,
  initOptions
)
export const playlistsAtom = atomWithStorage<Playlist[]>(
  'playlists',
  [],
  undefined,
  initOptions
)

// The account this copy belongs to (null: a guest's), and its changes not yet sent to that account
export const libraryOwnerAtom = atomWithStorage<string | null>(
  'libraryOwner',
  null,
  undefined,
  initOptions
)
export const libraryOutboxAtom = atomWithStorage<LibraryOp[]>(
  'libraryOutbox',
  [],
  undefined,
  initOptions
)

export const libraryAtom = atom(
  (get): Library => ({
    bookmarks: get(favoritesAtom),
    history: get(historyAtom),
    playlists: get(playlistsAtom),
  }),
  (_get, set, library: Library) => {
    set(historyAtom, library.history)
    set(favoritesAtom, library.bookmarks)
    set(playlistsAtom, library.playlists)
  }
)

// Every change to the library goes through here: applied on this device, and queued for the account when
// one is signed in (sync.tsx sends it)
export const recordLibraryAtom = atom(null, (get, set, op: LibraryOp) => {
  set(libraryAtom, applyOp(get(libraryAtom), op))
  if (get(libraryOwnerAtom) !== null) {
    set(libraryOutboxAtom, [...get(libraryOutboxAtom), op])
  }
})

export const addToHistoryAtom = atom(null, (_get, set, song: ListSong) => {
  set(recordLibraryAtom, { at: Date.now(), kind: 'play', song })
})

export const clearHistoryAtom = atom(null, (_get, set) => {
  set(recordLibraryAtom, { at: Date.now(), kind: 'clearHistory' })
})

export const addFavoriteAtom = atom(null, (_get, set, song: ListSong) => {
  set(recordLibraryAtom, {
    at: Date.now(),
    kind: 'bookmark',
    saved: true,
    song,
  })
})

export const removeFavoriteAtom = atom(null, (get, set, videoId: string) => {
  const song = get(favoritesAtom).find((saved) => saved.videoId === videoId)
  if (song !== undefined) {
    set(recordLibraryAtom, {
      at: Date.now(),
      kind: 'bookmark',
      saved: false,
      song,
    })
  }
})

export const isFavoriteAtom = atom(
  (get) => (videoId: string) =>
    get(favoritesAtom).some((item) => item.videoId === videoId)
)
