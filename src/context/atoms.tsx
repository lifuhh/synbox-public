import type { Getter, Setter, WritableAtom } from 'jotai'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

import type { LyricsStyle, LyricsStyleOverrides } from '@/lib/lyricsStyle'
import {
  DEFAULT_LYRICS_STYLE,
  readSongStyle,
  sameLyricsStyle,
  writeSongStyle,
} from '@/lib/lyricsStyle'
import type { LyricsBackdrop, LyricsThemeId } from '@/lib/lyricsThemes'
import type { CurrentPlayingInfo } from '@/types'

export const lyricsVisibilityAtom = atom(true)
export const romajiVisibilityAtom = atom(true)
export const translationVisibilityAtom = atom(true)
export const translationIsEnglishAtom = atom(true)

// The viewer's defaults, which every song follows until it is given its own style. The keys predate
// per-song styles, so a returning viewer's old settings become their defaults
const initOptions = { getOnInit: true }
const defaultLyricsStyleAtoms: {
  [K in keyof LyricsStyle]: WritableAtom<LyricsStyle[K], [LyricsStyle[K]], void>
} = {
  anchor: atomWithStorage(
    'lyricsAnchor',
    DEFAULT_LYRICS_STYLE.anchor,
    undefined,
    initOptions
  ),
  anchorPortrait: atomWithStorage(
    'lyricsAnchorPortrait',
    DEFAULT_LYRICS_STYLE.anchorPortrait,
    undefined,
    initOptions
  ),
  backdrop: atomWithStorage<LyricsBackdrop>(
    'lyricsBackdrop',
    DEFAULT_LYRICS_STYLE.backdrop,
    undefined,
    initOptions
  ),
  customHue: atomWithStorage(
    'lyricsCustomHue',
    DEFAULT_LYRICS_STYLE.customHue,
    undefined,
    initOptions
  ),
  fontSize: atomWithStorage(
    'fontSizeMultiplier',
    DEFAULT_LYRICS_STYLE.fontSize,
    undefined,
    initOptions
  ),
  themeId: atomWithStorage<LyricsThemeId>(
    'lyricsTheme',
    DEFAULT_LYRICS_STYLE.themeId,
    undefined,
    initOptions
  ),
}

const readDefaults = (get: Getter): LyricsStyle => ({
  anchor: get(defaultLyricsStyleAtoms.anchor),
  anchorPortrait: get(defaultLyricsStyleAtoms.anchorPortrait),
  backdrop: get(defaultLyricsStyleAtoms.backdrop),
  customHue: get(defaultLyricsStyleAtoms.customHue),
  fontSize: get(defaultLyricsStyleAtoms.fontSize),
  themeId: get(defaultLyricsStyleAtoms.themeId),
})

const LYRICS_STYLE_KEYS = [
  'anchor',
  'anchorPortrait',
  'backdrop',
  'customHue',
  'fontSize',
  'themeId',
] as const satisfies readonly (keyof LyricsStyle)[]

// The song on the player: the style it was given on this device, and a style from a shared link, shown
// over it for this visit only until the viewer keeps it, dismisses it or tunes it. null off the player,
// where a style change goes to the defaults
interface SongLyricsStyle {
  videoId: string
  overrides: LyricsStyleOverrides
  shared: LyricsStyle | null
}
const songLyricsStyleAtom = atom<SongLyricsStyle | null>(null)

export const lyricsStyleSongAtom = atom(
  (get) => get(songLyricsStyleAtom)?.videoId ?? null,
  (_get, set, videoId: string | null) => {
    set(
      songLyricsStyleAtom,
      videoId === null
        ? null
        : { overrides: readSongStyle(videoId), shared: null, videoId }
    )
  }
)

// Saves the song's own style, dropping any shared one: keeping or tuning a shared style makes it the
// viewer's own
const saveSongOverrides = (
  set: Setter,
  videoId: string,
  overrides: LyricsStyleOverrides
) => {
  set(songLyricsStyleAtom, { overrides, shared: null, videoId })
  writeSongStyle(videoId, overrides)
}

const ownOverrides = (song: SongLyricsStyle): LyricsStyleOverrides => ({
  ...song.overrides,
  ...song.shared,
})

const ownLyricsStyle = (get: Getter, song: SongLyricsStyle | null) => ({
  ...readDefaults(get),
  ...song?.overrides,
})

// What the lyrics look like right now, and what a shared link passes on
export const lyricsStyleAtom = atom((get) => {
  const song = get(songLyricsStyleAtom)
  return song?.shared ?? ownLyricsStyle(get, song)
})

export type LyricsStyleSource = 'shared' | 'song' | 'default'
export const lyricsStyleSourceAtom = atom<LyricsStyleSource | null>((get) => {
  const song = get(songLyricsStyleAtom)
  if (song === null) {
    return null
  }
  if (song.shared !== null) {
    return 'shared'
  }
  return Object.keys(song.overrides).length > 0 ? 'song' : 'default'
})

// A change on the player is saved for that song only
const lyricsStyleField = <K extends keyof LyricsStyle>(key: K) =>
  atom(
    (get) => get(lyricsStyleAtom)[key],
    (get, set, value: LyricsStyle[K]) => {
      const song = get(songLyricsStyleAtom)
      if (song === null) {
        set(defaultLyricsStyleAtoms[key], value)
        return
      }
      saveSongOverrides(set, song.videoId, {
        ...ownOverrides(song),
        [key]: value,
      })
    }
  )

export const fontSizeMultiplierAtom = lyricsStyleField('fontSize')
export const lyricsThemeIdAtom = lyricsStyleField('themeId')
export const lyricsCustomHueAtom = lyricsStyleField('customHue')
export const lyricsBackdropAtom = lyricsStyleField('backdrop')
export const lyricsAnchorAtom = lyricsStyleField('anchor')
export const lyricsAnchorPortraitAtom = lyricsStyleField('anchorPortrait')

// A shared style that matches the viewer's own changes nothing, so it is not shown as shared
export const showSharedLyricsStyleAtom = atom(
  null,
  (get, set, shared: LyricsStyle) => {
    const song = get(songLyricsStyleAtom)
    if (song !== null && !sameLyricsStyle(shared, ownLyricsStyle(get, song))) {
      set(songLyricsStyleAtom, { ...song, shared })
    }
  }
)

export const keepSharedLyricsStyleAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song?.shared) {
    saveSongOverrides(set, song.videoId, ownOverrides(song))
  }
})

export const dismissSharedLyricsStyleAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song !== null) {
    set(songLyricsStyleAtom, { ...song, shared: null })
  }
})

// Back to the defaults
export const resetSongLyricsStyleAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song !== null) {
    saveSongOverrides(set, song.videoId, {})
  }
})

// Makes the style on screen the default for every song without one of its own
export const applySongLyricsStyleToAllAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song === null) {
    return
  }
  const overrides = ownOverrides(song)
  const setDefault = <K extends keyof LyricsStyle>(
    key: K,
    value: LyricsStyle[K] | undefined
  ) => {
    if (value !== undefined) {
      set(defaultLyricsStyleAtoms[key], value)
    }
  }
  for (const key of LYRICS_STYLE_KEYS) {
    setDefault(key, overrides[key])
  }
  saveSongOverrides(set, song.videoId, {})
})

// Whether the player's floating UI shows: the rail, the top bar's buttons and the stage controls show and
// hide together. PlayerStage owns it
export const playerChromeOpenAtom = atom(true)
// The rail's lyrics style panel. 'peek' opened as the pointer came over the rail and closes when it
// leaves; 'pinned' was asked for (its button, a click on the lyrics) and stays until dismissed
export type LyricsStylePanel = 'closed' | 'peek' | 'pinned'
export const lyricsStylePanelAtom = atom<LyricsStylePanel>('closed')

export const playerVolumeAtom = atomWithStorage('playerVolume', {
  level: 0.5,
  muted: false,
})

interface FavoriteItem {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
}

export const currentVideoAtom = atom<CurrentPlayingInfo | null>(null)
export const favoritesAtom = atomWithStorage<FavoriteItem[]>('favorites', [])
export const addFavoriteAtom = atom(
  null,
  (get, set, newFavorite: FavoriteItem) => {
    const favorites = get(favoritesAtom)
    set(favoritesAtom, [...favorites, newFavorite])
  }
)

export const removeFavoriteAtom = atom(null, (get, set, videoId: string) => {
  const favorites = get(favoritesAtom)
  set(
    favoritesAtom,
    favorites.filter((item) => item.videoId !== videoId)
  )
})

export const isFavoriteAtom = atom((get) => (videoId: string) => {
  const favorites = get(favoritesAtom)
  return favorites.some((item) => item.videoId === videoId)
})

interface HistoryItem {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
  timestamp: number
}

export const historyAtom = atomWithStorage<HistoryItem[]>('history', [])

export const addToHistoryAtom = atom(
  null,
  (get, set, newItem: Omit<HistoryItem, 'timestamp'>) => {
    const history = get(historyAtom)

    const filteredHistory = history.filter(
      (item) => item.videoId !== newItem.videoId
    )

    const updatedHistory = [
      {
        ...newItem,
        timestamp: Date.now(),
      },
      ...filteredHistory,
    ]

    const limitedHistory = updatedHistory.slice(0, 100)

    set(historyAtom, limitedHistory)
  }
)
