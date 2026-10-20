import type { Setter, WritableAtom } from 'jotai'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

import type { LyricsStyle, LyricsStyleOverrides } from '@/lib/lyricsStyle'
import { readSongStyle, writeSongStyle } from '@/lib/lyricsStyle'
import type { LyricsBackdrop, LyricsThemeId } from '@/lib/lyricsThemes'
import {
  DEFAULT_LYRICS_BACKDROP,
  DEFAULT_LYRICS_CUSTOM_HUE,
  DEFAULT_LYRICS_THEME_ID,
} from '@/lib/lyricsThemes'
import type { CurrentPlayingInfo } from '@/types'

export const lyricsVisibilityAtom = atom(true)
export const romajiVisibilityAtom = atom(true)
export const translationVisibilityAtom = atom(true)
export const translationIsEnglishAtom = atom(true)

export const DEFAULT_FONT_SIZE = 1

// The viewer's defaults, which every song follows until it is given its own style. The keys predate
// per-song styles, so a returning viewer's old settings become their defaults
const initOptions = { getOnInit: true }
const defaultLyricsStyleAtoms: {
  [K in keyof LyricsStyle]: WritableAtom<LyricsStyle[K], [LyricsStyle[K]], void>
} = {
  anchor: atomWithStorage('lyricsAnchor', 0.85, undefined, initOptions),
  anchorPortrait: atomWithStorage(
    'lyricsAnchorPortrait',
    0.5,
    undefined,
    initOptions
  ),
  backdrop: atomWithStorage<LyricsBackdrop>(
    'lyricsBackdrop',
    DEFAULT_LYRICS_BACKDROP,
    undefined,
    initOptions
  ),
  customHue: atomWithStorage(
    'lyricsCustomHue',
    DEFAULT_LYRICS_CUSTOM_HUE,
    undefined,
    initOptions
  ),
  fontSize: atomWithStorage(
    'fontSizeMultiplier',
    DEFAULT_FONT_SIZE,
    undefined,
    initOptions
  ),
  themeId: atomWithStorage<LyricsThemeId>(
    'lyricsTheme',
    DEFAULT_LYRICS_THEME_ID,
    undefined,
    initOptions
  ),
}

const LYRICS_STYLE_KEYS = [
  'anchor',
  'anchorPortrait',
  'backdrop',
  'customHue',
  'fontSize',
  'themeId',
] as const satisfies readonly (keyof LyricsStyle)[]

// The song on the player and the style it was given on this device. null off the player, where a
// style change goes to the defaults
const songLyricsStyleAtom = atom<{
  videoId: string
  overrides: LyricsStyleOverrides
} | null>(null)

export const lyricsStyleSongAtom = atom(
  (get) => get(songLyricsStyleAtom)?.videoId ?? null,
  (_get, set, videoId: string | null) => {
    set(
      songLyricsStyleAtom,
      videoId === null ? null : { overrides: readSongStyle(videoId), videoId }
    )
  }
)

const setSongOverrides = (
  set: Setter,
  videoId: string,
  overrides: LyricsStyleOverrides
) => {
  set(songLyricsStyleAtom, { overrides, videoId })
  writeSongStyle(videoId, overrides)
}

// Reads the song's own value, else the default; a change on the player is saved for that song only
const lyricsStyleField = <K extends keyof LyricsStyle>(key: K) =>
  atom(
    (get) =>
      get(songLyricsStyleAtom)?.overrides[key] ??
      get(defaultLyricsStyleAtoms[key]),
    (get, set, value: LyricsStyle[K]) => {
      const song = get(songLyricsStyleAtom)
      if (song === null) {
        set(defaultLyricsStyleAtoms[key], value)
        return
      }
      setSongOverrides(set, song.videoId, {
        ...song.overrides,
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

export const songHasOwnLyricsStyleAtom = atom(
  (get) => Object.keys(get(songLyricsStyleAtom)?.overrides ?? {}).length > 0
)

// Back to the defaults
export const resetSongLyricsStyleAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song !== null) {
    setSongOverrides(set, song.videoId, {})
  }
})

// Makes the song's style the default for every song without one of its own
export const applySongLyricsStyleToAllAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song === null) {
    return
  }
  const setDefault = <K extends keyof LyricsStyle>(
    key: K,
    value: LyricsStyle[K] | undefined
  ) => {
    if (value !== undefined) {
      set(defaultLyricsStyleAtoms[key], value)
    }
  }
  for (const key of LYRICS_STYLE_KEYS) {
    setDefault(key, song.overrides[key])
  }
  setSongOverrides(set, song.videoId, {})
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
