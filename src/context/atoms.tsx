import type { Getter, Setter, WritableAtom } from 'jotai'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { z } from 'zod'

import type {
  LyricsStyle,
  LyricsStyleOverrides,
  ScreenSizes,
  SharedLyricsStyle,
} from '@/lib/lyrics-style'
import {
  DEFAULT_LYRICS_STYLE,
  lyricsThemeIdSchema,
  readSongStyle,
  sameLyricsStyle,
  screenSizesSchema,
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
// - Shared: a style from a shared link, shown over the viewer's own for one visit. It is never stored: opening a
//   link changes nothing the viewer keeps, and a change made while it shows saves only the field changed
// Changes on the player go to My Default or to This Song, as the panel's "Changes Apply To" says: All Songs while the
// song follows the default, This Song once it has a style of its own. (My Styles, named whole styles, went on
// 2026-10-26; their `lyricsTemplates` value stays on devices and accounts, unread, for a later cleanup to drop)

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
  // The fields still shown from a shared link, in memory only
  shared: LyricsStyleOverrides | null
  scope: LyricsStyleScope
}
const songLyricsStyleAtom = atom<SongLyricsStyle | null>(null)

const hasOwnStyle = (overrides: LyricsStyleOverrides) =>
  Object.keys(overrides).length > 0

// Whether the listener has moved the lyrics or the translation themselves (a drag let go, docking included), which
// Reset Positions clears: Lyrics Style offers Reset Positions only then, never because the app nudged a place (Karaoke
// Style's switch keeps the rows' centre by rewriting their anchor). null on a device from before it existed, set
// once from whether the places it would reset are away from their start (2026-10-27)
export const lyricsPositionsDraggedAtom = atomWithStorage<boolean | null>(
  'lyricsPositionsDragged',
  null,
  undefined,
  { getOnInit: true }
)

const positionsAway = (style: LyricsStyle, docked: boolean) =>
  style.anchor !== DEFAULT_LYRICS_STYLE.anchor ||
  style.anchorPortrait !== DEFAULT_LYRICS_STYLE.anchorPortrait ||
  style.translationAnchor !== DEFAULT_LYRICS_STYLE.translationAnchor ||
  docked

export const lyricsStyleSongAtom = atom(
  (get) => get(songLyricsStyleAtom)?.videoId ?? null,
  (get, set, videoId: string | null) => {
    if (videoId === null) {
      set(songLyricsStyleAtom, null)
      return
    }
    const overrides = readSongStyle(videoId)
    if (get(lyricsPositionsDraggedAtom) === null) {
      set(
        lyricsPositionsDraggedAtom,
        positionsAway(
          { ...readDefaults(get), ...overrides },
          get(translationDockedAtom)
        )
      )
    }
    set(songLyricsStyleAtom, {
      overrides,
      scope: hasOwnStyle(overrides) ? 'song' : 'all',
      shared: null,
      videoId,
    })
  }
)

// Saves the song's own style. A shared style showing stays shown, never saved
const saveSongOverrides = (
  set: Setter,
  song: SongLyricsStyle,
  overrides: LyricsStyleOverrides,
  scope: LyricsStyleScope = song.scope
) => {
  set(songLyricsStyleAtom, { ...song, overrides, scope })
  writeSongStyle(song.videoId, overrides)
}

// Puts a song's style back as it was, for Undo
const restoreSong = (set: Setter, song: SongLyricsStyle) => {
  set(songLyricsStyleAtom, song)
  writeSongStyle(song.videoId, song.overrides)
}

const ownLyricsStyle = (get: Getter, song: SongLyricsStyle | null) => ({
  ...readDefaults(get),
  ...song?.overrides,
})

// What the lyrics look like right now, and what a shared link passes on
export const lyricsStyleAtom = atom((get): LyricsStyle => {
  const song = get(songLyricsStyleAtom)
  return { ...ownLyricsStyle(get, song), ...song?.shared }
})

// Whether this song has a style of its own; a shared style showing doesn't count, it isn't the viewer's
export type LyricsStyleSource = 'song' | 'default'
export const lyricsStyleSourceAtom = atom<LyricsStyleSource | null>((get) => {
  const song = get(songLyricsStyleAtom)
  if (song === null) {
    return null
  }
  return hasOwnStyle(song.overrides) ? 'song' : 'default'
})

// Where the next change goes, and what the song follows. This Song: changes go to the song alone (it looks as it did
// until the first one). All Songs: the song follows the shared style, so choosing it for a song with its own style
// lets that style go (owner, 2026-10-26: the choice is the state; no separate Reset This Song). Returns the Undo when
// it let a style go, else null
export const lyricsStyleScopeAtom = atom(
  (get): LyricsStyleScope => get(songLyricsStyleAtom)?.scope ?? 'all',
  (get, set, scope: LyricsStyleScope): (() => void) | null => {
    const song = get(songLyricsStyleAtom)
    if (song === null) {
      return null
    }
    if (scope === 'all' && hasOwnStyle(song.overrides)) {
      // Back to the viewer's own default: a shared style showing goes too, as Reset This Song's did (#507)
      saveSongOverrides(set, { ...song, shared: null }, {}, 'all')
      return () => {
        restoreSong(set, song)
      }
    }
    set(songLyricsStyleAtom, { ...song, scope })
    return null
  }
)

const without = (
  fields: LyricsStyleOverrides,
  change: LyricsStyleOverrides
): LyricsStyleOverrides =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => !(key in change)))

// Applies a change where the scope says. For All Songs it becomes the default, and this song lets go of its
// own value for those fields, so the change shows here too. Over a shared style, the changed fields stop
// coming from the link (so the change shows) and are saved by the same rules; the link's other fields stay
// shown for this visit and are never saved
const applyLyricsStyle = (
  get: Getter,
  set: Setter,
  change: LyricsStyleOverrides
) => {
  const current = get(songLyricsStyleAtom)
  if (current === null) {
    setDefaults(set, change)
    return
  }
  const song =
    current.shared === null
      ? current
      : { ...current, shared: without(current.shared, change) }
  if (song.scope === 'song') {
    saveSongOverrides(set, song, { ...song.overrides, ...change })
    return
  }
  setDefaults(set, change)
  const kept = without(song.overrides, change)
  if (Object.keys(kept).length !== Object.keys(song.overrides).length) {
    saveSongOverrides(set, song, kept)
  } else if (song !== current) {
    set(songLyricsStyleAtom, song)
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

// Reset Positions: the lyrics, their upright place and Karaoke Style's translation back where they start (rows at the
// foot, the translation at the top, undocked), wherever the changes go. Always one tap out of a layout that got stuck.
// Returns its Undo
export const resetLyricsPositionsAtom = atom(null, (get, set) => {
  const before = {
    anchor: get(lyricsAnchorAtom),
    anchorPortrait: get(lyricsAnchorPortraitAtom),
    translationAnchor: get(lyricsTranslationAnchorAtom),
  }
  const docked = get(translationDockedAtom)
  const dragged = get(lyricsPositionsDraggedAtom)
  applyLyricsStyle(get, set, {
    anchor: DEFAULT_LYRICS_STYLE.anchor,
    anchorPortrait: DEFAULT_LYRICS_STYLE.anchorPortrait,
    translationAnchor: DEFAULT_LYRICS_STYLE.translationAnchor,
  })
  set(translationDockedAtom, false)
  set(lyricsPositionsDraggedAtom, false)
  return () => {
    applyLyricsStyle(get, set, before)
    set(translationDockedAtom, docked)
    set(lyricsPositionsDraggedAtom, dragged)
  }
})

// Lyrics Style offers Reset Positions while the listener has moved something and it is still away from its start
export const lyricsPositionsMovedAtom = atom(
  (get) =>
    get(lyricsPositionsDraggedAtom) === true &&
    positionsAway(get(lyricsStyleAtom), get(translationDockedAtom))
)

// The account's newer value for a style key has just been written to the device (src/lib/prefs/sync.tsx):
// what is read once rather than through an atom over the key is read again
export const reloadStoredStyleAtom = atom(null, (get, set, key: string) => {
  const song = get(songLyricsStyleAtom)
  if (song !== null && key === `lyricsStyle:${song.videoId}`) {
    set(lyricsStyleSongAtom, song.videoId)
  }
})

// Whether the player's floating UI shows: the rail, the top bar's buttons and the stage controls show and
// hide together. PlayerStage owns it
export const playerChromeOpenAtom = atom(true)
// Set while something anchored to the floating UI must be seen (Report Sent beside its button): PlayerStage shows
// the UI for as long, and counts the release as activity
export const playerChromeHeldAtom = atom(false)
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

// Playback speed for this visit, every song included, as YouTube keeps it; a new visit starts at 1, so nobody finds a
// song slowed without having asked. The player's Playback Speed sets it, with the engine (setEngineRate)
export const playbackRateAtom = atom(1)

export const currentVideoAtom = atom<CurrentPlayingInfo | null>(null)
