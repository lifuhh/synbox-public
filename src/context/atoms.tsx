import type { Getter, Setter, WritableAtom } from 'jotai'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

import type {
  LyricsStyle,
  LyricsStyleOverrides,
  LyricsTemplate,
  ScreenSizes,
  SharedLyricsStyle,
} from '@/lib/lyrics-style'
import {
  DEFAULT_LYRICS_STYLE,
  MAX_LYRICS_TEMPLATES,
  readLyricsTemplates,
  readSongStyle,
  sameLyricsStyle,
  screenSizesSchema,
  writeLyricsTemplates,
  writeSongStyle,
} from '@/lib/lyrics-style'
import type { LyricsBackdrop, LyricsThemeId } from '@/lib/lyrics-themes'
import type { CurrentPlayingInfo } from '@/types'

export const lyricsVisibilityAtom = atom(true)
export const romajiVisibilityAtom = atom(true)
export const translationVisibilityAtom = atom(true)
export const translationIsEnglishAtom = atom(true)

// The lyrics style has three layers, each on this device only:
// - My Default: what every song looks like until it is given its own style
// - This Song: the fields the viewer changed for one song (`lyricsStyle:<videoId>`), which win over the default
// - Shared: a style from a shared link, shown over the viewer's own for one visit
// plus My Styles, named whole styles to apply in one tap. Changes on the player go to My Default or to This
// Song, as the panel's "Changes Apply To" says: All Songs while the song follows the default, This Song once
// it has a style of its own

// My Default. The keys predate per-song styles, so a returning viewer's old settings became their defaults
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
  screenSizes: atomWithStorage<ScreenSizes>(
    'lyricsScreenSizes',
    DEFAULT_LYRICS_STYLE.screenSizes,
    undefined,
    initOptions
  ),
  themeId: atomWithStorage<LyricsThemeId>(
    'lyricsTheme',
    DEFAULT_LYRICS_STYLE.themeId,
    undefined,
    initOptions
  ),
  twoLines: atomWithStorage(
    'lyricsTwoLines',
    DEFAULT_LYRICS_STYLE.twoLines,
    undefined,
    initOptions
  ),
}

const readDefaults = (get: Getter): LyricsStyle => {
  const screenSizes = screenSizesSchema.safeParse(
    get(defaultLyricsStyleAtoms.screenSizes)
  )
  return {
    anchor: get(defaultLyricsStyleAtoms.anchor),
    anchorPortrait: get(defaultLyricsStyleAtoms.anchorPortrait),
    backdrop: get(defaultLyricsStyleAtoms.backdrop),
    customHue: get(defaultLyricsStyleAtoms.customHue),
    fontSize: get(defaultLyricsStyleAtoms.fontSize),
    screenSizes: screenSizes.success
      ? screenSizes.data
      : DEFAULT_LYRICS_STYLE.screenSizes,
    themeId: get(defaultLyricsStyleAtoms.themeId),
    twoLines: get(defaultLyricsStyleAtoms.twoLines),
  }
}

const LYRICS_STYLE_KEYS = [
  'anchor',
  'anchorPortrait',
  'backdrop',
  'customHue',
  'fontSize',
  'screenSizes',
  'themeId',
  'twoLines',
] as const satisfies readonly (keyof LyricsStyle)[]

const setDefaults = (set: Setter, style: LyricsStyleOverrides) => {
  const setDefault = <K extends keyof LyricsStyle>(
    key: K,
    value: LyricsStyle[K] | undefined
  ) => {
    if (value !== undefined) {
      set(defaultLyricsStyleAtoms[key], value)
    }
  }
  for (const key of LYRICS_STYLE_KEYS) {
    setDefault(key, style[key])
  }
}

export type LyricsStyleScope = 'all' | 'song'

// The song on the player: its own style, a shared style shown over it, and where changes go. null off the
// player, where a change goes to the defaults
interface SongLyricsStyle {
  videoId: string
  overrides: LyricsStyleOverrides
  shared: SharedLyricsStyle | null
  scope: LyricsStyleScope
}
const songLyricsStyleAtom = atom<SongLyricsStyle | null>(null)

const hasOwnStyle = (overrides: LyricsStyleOverrides) =>
  Object.keys(overrides).length > 0

export const lyricsStyleSongAtom = atom(
  (get) => get(songLyricsStyleAtom)?.videoId ?? null,
  (_get, set, videoId: string | null) => {
    if (videoId === null) {
      set(songLyricsStyleAtom, null)
      return
    }
    const overrides = readSongStyle(videoId)
    set(songLyricsStyleAtom, {
      overrides,
      scope: hasOwnStyle(overrides) ? 'song' : 'all',
      shared: null,
      videoId,
    })
  }
)

// Saves the song's own style, dropping any shared one: keeping or tuning a shared style makes it the
// viewer's own
const saveSongOverrides = (
  set: Setter,
  song: SongLyricsStyle,
  overrides: LyricsStyleOverrides,
  scope: LyricsStyleScope = song.scope
) => {
  set(songLyricsStyleAtom, { ...song, overrides, scope, shared: null })
  writeSongStyle(song.videoId, overrides)
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
export const lyricsStyleAtom = atom((get): LyricsStyle => {
  const song = get(songLyricsStyleAtom)
  return { ...ownLyricsStyle(get, song), ...song?.shared }
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
  return hasOwnStyle(song.overrides) ? 'song' : 'default'
})

// Where the next change goes. Switching never discards anything: a song's own fields stay until a change to
// that field for All Songs, Reset This Song to My Default, or Save as My Default
export const lyricsStyleScopeAtom = atom(
  (get): LyricsStyleScope => {
    const song = get(songLyricsStyleAtom)
    if (song === null) {
      return 'all'
    }
    // A change to a shared style keeps it as this song's own
    return song.shared === null ? song.scope : 'song'
  },
  (get, set, scope: LyricsStyleScope) => {
    const song = get(songLyricsStyleAtom)
    if (song !== null) {
      set(songLyricsStyleAtom, { ...song, scope })
    }
  }
)

// Applies a change where the scope says. For All Songs it becomes the default, and this song lets go of its
// own value for those fields, so the change shows here too. A change to a shared style keeps it as the
// song's own
const applyLyricsStyle = (
  get: Getter,
  set: Setter,
  change: LyricsStyleOverrides
) => {
  const song = get(songLyricsStyleAtom)
  if (song === null) {
    setDefaults(set, change)
    return
  }
  if (song.shared !== null || song.scope === 'song') {
    saveSongOverrides(set, song, { ...ownOverrides(song), ...change }, 'song')
    return
  }
  setDefaults(set, change)
  const kept = Object.fromEntries(
    Object.entries(song.overrides).filter(([key]) => !(key in change))
  )
  if (Object.keys(kept).length !== Object.keys(song.overrides).length) {
    saveSongOverrides(set, song, kept)
  }
}

const lyricsStyleField = <K extends keyof LyricsStyle>(key: K) =>
  atom(
    (get) => get(lyricsStyleAtom)[key],
    (get, set, value: LyricsStyle[K]) => {
      applyLyricsStyle(get, set, { [key]: value })
    }
  )

export const fontSizeMultiplierAtom = lyricsStyleField('fontSize')
export const lyricsThemeIdAtom = lyricsStyleField('themeId')
export const lyricsCustomHueAtom = lyricsStyleField('customHue')
export const lyricsBackdropAtom = lyricsStyleField('backdrop')
export const lyricsAnchorAtom = lyricsStyleField('anchor')
export const lyricsAnchorPortraitAtom = lyricsStyleField('anchorPortrait')
export const lyricsTwoLinesAtom = lyricsStyleField('twoLines')
export const lyricsScreenSizesAtom = lyricsStyleField('screenSizes')

// A shared style that matches the viewer's own changes nothing, so it is not shown as shared
export const showSharedLyricsStyleAtom = atom(
  null,
  (get, set, shared: SharedLyricsStyle) => {
    const song = get(songLyricsStyleAtom)
    if (song !== null && !sameLyricsStyle(shared, ownLyricsStyle(get, song))) {
      set(songLyricsStyleAtom, { ...song, shared })
    }
  }
)

export const keepSharedLyricsStyleAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song?.shared) {
    saveSongOverrides(set, song, ownOverrides(song), 'song')
  }
})

export const dismissSharedLyricsStyleAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song !== null) {
    set(songLyricsStyleAtom, { ...song, shared: null })
  }
})

// Reset This Song to My Default
export const resetSongLyricsStyleAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song !== null) {
    saveSongOverrides(set, song, {}, 'all')
  }
})

// Save as My Default: the style on screen becomes the default for every song without one of its own, and
// this song follows it again
export const applySongLyricsStyleToAllAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song === null) {
    return
  }
  setDefaults(set, ownOverrides(song))
  saveSongOverrides(set, song, {}, 'all')
})

// My Styles
const templatesSavedAtom = atom<LyricsTemplate[] | null>(null)
export const lyricsTemplatesAtom = atom(
  (get) => get(templatesSavedAtom) ?? readLyricsTemplates()
)
const saveTemplates = (set: Setter, templates: LyricsTemplate[]) => {
  set(templatesSavedAtom, templates)
  writeLyricsTemplates(templates)
}

// Saves the style on screen under a name; a name already in use is replaced
export const saveLyricsTemplateAtom = atom(null, (get, set, name: string) => {
  const kept = get(lyricsTemplatesAtom).filter(
    (template) => template.name !== name
  )
  if (kept.length >= MAX_LYRICS_TEMPLATES) {
    return
  }
  saveTemplates(set, [
    ...kept,
    {
      id: crypto.randomUUID(),
      name,
      savedAt: Date.now(),
      style: get(lyricsStyleAtom),
    },
  ])
})

// Applies a saved style where changes go: to this song, or to My Default
export const applyLyricsTemplateAtom = atom(null, (get, set, id: string) => {
  const template = get(lyricsTemplatesAtom).find((t) => t.id === id)
  if (template !== undefined) {
    applyLyricsStyle(get, set, template.style)
  }
})

export const deleteLyricsTemplateAtom = atom(null, (get, set, id: string) => {
  saveTemplates(
    set,
    get(lyricsTemplatesAtom).filter((template) => template.id !== id)
  )
})

// Whether the player's floating UI shows: the rail, the top bar's buttons and the stage controls show and
// hide together. PlayerStage owns it
export const playerChromeOpenAtom = atom(true)
// The rail's lyrics style panel. 'peek' opened as the pointer came over the rail and closes when it
// leaves; 'pinned' was asked for (its button, a click on the lyrics) and stays until dismissed
export type LyricsStylePanel = 'closed' | 'peek' | 'pinned'
export const lyricsStylePanelAtom = atom<LyricsStylePanel>('closed')

// How the player sits on the page when it is not the whole screen. 'default' is the watch page: the video top
// left with the lyrics beside it and the song and Up Next below. 'theater' gives the video the page's full
// width (wide screens only). Fullscreen is the stage alone, the player as it always was. Kept on this device
export type WatchLayout = 'default' | 'theater'
export const watchLayoutAtom = atomWithStorage<WatchLayout>(
  'playerWatchLayout',
  'default'
)
// How the player page shows right now: the watch page, or the stage alone (fullscreen, a phone on its side,
// Lock Landscape). PlayerPage sets it; the top bar reads it. null away from the player
export const playerSurfaceAtom = atom<'stage' | 'watch' | null>(null)
// Whether the stage is the whole screen right now: browser fullscreen, or iPhone's stand-in for it.
// PlayerStage owns it
export const stageFullscreenAtom = atom(false)
// The playing song's clock for what sits outside the stage (the watch page's lyrics): its time, a seek, and
// a call on every frame. PlayerStage sets it while it is mounted
export interface StageClock {
  getTime: () => number
  seek: (seconds: number) => void
  subscribeFrame: (listener: (time: number) => void) => () => void
}
export const stageClockAtom = atom<StageClock | null>(null)

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
