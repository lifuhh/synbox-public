import type { Getter, Setter, WritableAtom } from 'jotai'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { z } from 'zod'

import type {
  LyricsStyle,
  LyricsStyleOverrides,
  LyricsTemplate,
  ScreenSizes,
  SharedLyricsStyle,
} from '@/lib/lyrics-style'
import {
  DEFAULT_LYRICS_STYLE,
  lyricsThemeIdSchema,
  MAX_LYRICS_TEMPLATES,
  readLyricsTemplates,
  readSongStyle,
  sameLyricsStyle,
  screenSizesSchema,
  writeLyricsTemplates,
  writeSongStyle,
} from '@/lib/lyrics-style'
import type { LyricsThemeId } from '@/lib/lyrics-themes'
import { syncedStorage } from '@/lib/prefs/storage'
import type { CurrentPlayingInfo } from '@/types'

// What the lyrics show, kept across visits and synced to the account like the style (src/lib/prefs)
const shownOptions = { getOnInit: true }
export const lyricsVisibilityAtom = atomWithStorage(
  'lyricsShowLyrics',
  true,
  syncedStorage(),
  shownOptions
)
export const romajiVisibilityAtom = atomWithStorage(
  'lyricsShowRomaji',
  true,
  syncedStorage(),
  shownOptions
)
export const translationVisibilityAtom = atomWithStorage(
  'lyricsShowTranslation',
  true,
  syncedStorage(),
  shownOptions
)
// Karaoke Style's translation docked under the rows instead of in its own room at the top: one choice for every
// song, not part of a song's style (nor of a shared link)
export const translationDockedAtom = atomWithStorage(
  'lyricsTranslationDocked',
  false,
  syncedStorage(),
  shownOptions
)
export const translationIsEnglishAtom = atomWithStorage(
  'lyricsTranslationEnglish',
  true,
  syncedStorage(),
  shownOptions
)

// The lyrics style has three layers, kept on the device and synced to a signed-in account (src/lib/prefs):
// - My Default: what every song looks like until it is given its own style
// - This Song: the fields the viewer changed for one song (`lyricsStyle:<videoId>`), which win over the default
// - Shared: a style from a shared link, shown over the viewer's own for one visit
// plus My Styles, named whole styles to apply in one tap. Changes on the player go to My Default or to This
// Song, as the panel's "Changes Apply To" says: All Songs while the song follows the default, This Song once
// it has a style of its own

// My Default. The keys predate per-song styles, so a returning viewer's old settings became their defaults
const initOptions = { getOnInit: true }

// Whether the player shows as Theater right now (the watch page, wide, Theater on). PlayerPage sets it
export const theaterShownAtom = atom(false)
// Karaoke Style in My Default, one per watch layout: on in Theater, where the video spans the page as on a
// karaoke screen, off in the default view, whose lyrics sit beside a smaller video. A pick in one layout is that
// layout's own, so turning it off beside the video leaves Theater's on. Fullscreen and phones follow the default
// view
const TWO_LINES_BY_LAYOUT: Record<WatchLayout, boolean> = {
  default: false,
  theater: true,
}
type TwoLinesPicks = Partial<Record<WatchLayout, boolean>>
// The key once held one pick for every layout; such a pick was made beside the video, so it becomes the default
// view's. Anything else unreadable is no pick
const twoLinesPicksSchema = z.union([
  z.boolean().transform((picked): TwoLinesPicks => ({ default: picked })),
  z.object({ default: z.boolean(), theater: z.boolean() }).partial(),
])
const twoLinesPicksAtom = atomWithStorage<unknown>(
  'lyricsTwoLines',
  null,
  syncedStorage(),
  initOptions
)
const readTwoLinesPicks = (get: Getter): TwoLinesPicks => {
  const parsed = twoLinesPicksSchema.safeParse(get(twoLinesPicksAtom))
  return parsed.success ? parsed.data : {}
}
const shownLayout = (get: Getter): WatchLayout =>
  get(theaterShownAtom) ? 'theater' : 'default'

const defaultLyricsStyleAtoms: {
  [K in keyof LyricsStyle]: WritableAtom<LyricsStyle[K], [LyricsStyle[K]], void>
} = {
  anchor: atomWithStorage(
    'lyricsAnchor',
    DEFAULT_LYRICS_STYLE.anchor,
    syncedStorage(),
    initOptions
  ),
  anchorPortrait: atomWithStorage(
    'lyricsAnchorPortrait',
    DEFAULT_LYRICS_STYLE.anchorPortrait,
    syncedStorage(),
    initOptions
  ),
  customHue: atomWithStorage(
    'lyricsCustomHue',
    DEFAULT_LYRICS_STYLE.customHue,
    syncedStorage(),
    initOptions
  ),
  fontSize: atomWithStorage(
    'fontSizeMultiplier',
    DEFAULT_LYRICS_STYLE.fontSize,
    syncedStorage(),
    initOptions
  ),
  fontSizeTwoLines: atomWithStorage(
    'lyricsFontSizeTwoLines',
    DEFAULT_LYRICS_STYLE.fontSizeTwoLines,
    syncedStorage(),
    initOptions
  ),
  screenSizes: atomWithStorage<ScreenSizes>(
    'lyricsScreenSizes',
    DEFAULT_LYRICS_STYLE.screenSizes,
    syncedStorage(),
    initOptions
  ),
  themeId: atomWithStorage<LyricsThemeId>(
    'lyricsTheme',
    DEFAULT_LYRICS_STYLE.themeId,
    syncedStorage(),
    initOptions
  ),
  translationAnchor: atomWithStorage(
    'lyricsTranslationAnchor',
    DEFAULT_LYRICS_STYLE.translationAnchor,
    syncedStorage(),
    initOptions
  ),

  twoLines: atom(
    (get) => {
      const layout = shownLayout(get)
      return readTwoLinesPicks(get)[layout] ?? TWO_LINES_BY_LAYOUT[layout]
    },
    (get, set, picked: boolean) => {
      set(twoLinesPicksAtom, {
        ...readTwoLinesPicks(get),
        [shownLayout(get)]: picked,
      })
    }
  ),
}

const readDefaults = (get: Getter): LyricsStyle => {
  const screenSizes = screenSizesSchema.safeParse(
    get(defaultLyricsStyleAtoms.screenSizes)
  )
  const themeId = lyricsThemeIdSchema.safeParse(
    get(defaultLyricsStyleAtoms.themeId)
  )
  return {
    anchor: get(defaultLyricsStyleAtoms.anchor),
    anchorPortrait: get(defaultLyricsStyleAtoms.anchorPortrait),
    customHue: get(defaultLyricsStyleAtoms.customHue),
    fontSize: get(defaultLyricsStyleAtoms.fontSize),
    fontSizeTwoLines: get(defaultLyricsStyleAtoms.fontSizeTwoLines),
    screenSizes: screenSizes.success
      ? screenSizes.data
      : DEFAULT_LYRICS_STYLE.screenSizes,
    themeId: themeId.success ? themeId.data : DEFAULT_LYRICS_STYLE.themeId,
    translationAnchor: get(defaultLyricsStyleAtoms.translationAnchor),
    twoLines: get(defaultLyricsStyleAtoms.twoLines),
  }
}

const LYRICS_STYLE_KEYS = [
  'anchor',
  'anchorPortrait',
  'customHue',
  'fontSize',
  'fontSizeTwoLines',
  'screenSizes',
  'themeId',
  'translationAnchor',
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
export const lyricsAnchorAtom = lyricsStyleField('anchor')
export const lyricsAnchorPortraitAtom = lyricsStyleField('anchorPortrait')
export const lyricsTranslationAnchorAtom = lyricsStyleField('translationAnchor')
export const lyricsTwoLinesAtom = lyricsStyleField('twoLines')
export const lyricsFontSizeTwoLinesAtom = lyricsStyleField('fontSizeTwoLines')
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

// Puts a song's style back as it was, for Undo
const restoreSong = (set: Setter, song: SongLyricsStyle) => {
  set(songLyricsStyleAtom, song)
  writeSongStyle(song.videoId, song.overrides)
}

// Reset This Song to My Default. Returns its Undo
export const resetSongLyricsStyleAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song === null) {
    return null
  }
  saveSongOverrides(set, song, {}, 'all')
  return () => {
    restoreSong(set, song)
  }
})

// Reset Positions: the lyrics, their upright place and Karaoke Style's translation back where they start (rows at the
// foot, the translation at the top, undocked), wherever the changes go. Always one tap out of a layout that got stuck.
// Returns its Undo
// When positions were last reset (performance.now()): the rows then go where the reset puts them, not back to where
// they were across the room change it makes (stage-lyrics › useTranslationDock)
export const positionsResetAtAtom = atom(0)
export const resetLyricsPositionsAtom = atom(null, (get, set) => {
  set(positionsResetAtAtom, performance.now())
  const before = {
    anchor: get(lyricsAnchorAtom),
    anchorPortrait: get(lyricsAnchorPortraitAtom),
    translationAnchor: get(lyricsTranslationAnchorAtom),
  }
  const docked = get(translationDockedAtom)
  applyLyricsStyle(get, set, {
    anchor: DEFAULT_LYRICS_STYLE.anchor,
    anchorPortrait: DEFAULT_LYRICS_STYLE.anchorPortrait,
    translationAnchor: DEFAULT_LYRICS_STYLE.translationAnchor,
  })
  set(translationDockedAtom, false)
  return () => {
    applyLyricsStyle(get, set, before)
    set(translationDockedAtom, docked)
  }
})

// Save as My Default: the style on screen becomes the default for every song without one of its own, and
// this song follows it again. Returns its Undo
export const applySongLyricsStyleToAllAtom = atom(null, (get, set) => {
  const song = get(songLyricsStyleAtom)
  if (song === null) {
    return null
  }
  const defaults = readDefaults(get)
  setDefaults(set, ownOverrides(song))
  saveSongOverrides(set, song, {}, 'all')
  return () => {
    setDefaults(set, defaults)
    restoreSong(set, song)
  }
})

// My Styles
const templatesSavedAtom = atom<LyricsTemplate[] | null>(null)

// The account's newer value for a style key has just been written to the device (src/lib/prefs/sync.tsx):
// what is read once rather than through an atom over the key is read again
export const reloadStoredStyleAtom = atom(null, (get, set, key: string) => {
  if (key === 'lyricsTemplates') {
    set(templatesSavedAtom, null)
  }
  const song = get(songLyricsStyleAtom)
  if (song !== null && key === `lyricsStyle:${song.videoId}`) {
    set(lyricsStyleSongAtom, song.videoId)
  }
})
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

// Returns its Undo
export const deleteLyricsTemplateAtom = atom(null, (get, set, id: string) => {
  const before = get(lyricsTemplatesAtom)
  saveTemplates(
    set,
    before.filter((template) => template.id !== id)
  )
  return () => {
    saveTemplates(set, before)
  }
})

// Whether the player's floating UI shows: the rail, the top bar's buttons and the stage controls show and
// hide together. PlayerStage owns it
export const playerChromeOpenAtom = atom(true)
// The home page's own search field, which the top bar's search docks from once it scrolls under the bar
export const homeSearchFieldAtom = atom<HTMLElement | null>(null)
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
// The song on the player when it is a chart song (in YouTube's Top 100 Japan, not in the library: presence.ts),
// with its rank. PlayerPage sets it; the song facts, the lyrics panel and the rail read it. null otherwise
export const chartSongAtom = atom<{ videoId: string; rank: number } | null>(
  null
)
// Whether the stage is the whole screen right now: browser fullscreen, or iPhone's stand-in for it.
// PlayerStage owns it
export const stageFullscreenAtom = atom(false)
// The playing song's clock for what sits outside the stage (the watch page's lyrics, Report Issue, the YouTube
// link): its time, a seek, a pause, and a call on every frame. PlayerStage sets it while it is mounted
export interface StageClock {
  getTime: () => number
  seek: (seconds: number) => void
  pause: () => void
  subscribeFrame: (listener: (time: number) => void) => () => void
}
export const stageClockAtom = atom<StageClock | null>(null)

export const playerVolumeAtom = atomWithStorage('playerVolume', {
  level: 0.5,
  muted: false,
})

export const currentVideoAtom = atom<CurrentPlayingInfo | null>(null)
