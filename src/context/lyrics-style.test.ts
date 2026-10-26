// @vitest-environment happy-dom
import { createStore } from 'jotai'
import { beforeEach, expect, test } from 'vite-plus/test'

import {
  DEFAULT_LYRICS_STYLE,
  decodeSharedStyle,
  encodeSharedStyle,
  sameSavedLyricsStyle,
} from '@/lib/lyrics-style'

import {
  applyLyricsTemplateAtom,
  lyricsCustomHueAtom,
  lyricsScreenSizesAtom,
  applySongLyricsStyleToAllAtom,
  fontSizeMultiplierAtom,
  lyricsAnchorAtom,
  lyricsStyleAtom,
  lyricsStyleScopeAtom,
  lyricsStyleSongAtom,
  lyricsTemplatesAtom,
  lyricsThemeIdAtom,
  lyricsTwoLinesAtom,
  lyricsStyleSourceAtom,
  resetSongLyricsStyleAtom,
  saveLyricsTemplateAtom,
  showSharedLyricsStyleAtom,
  theaterShownAtom,
} from './atoms'

beforeEach(() => {
  localStorage.clear()
})

// Everything kept on the device, to compare before and after
const stored = () =>
  JSON.stringify(
    Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])
  )

test('a song keeps its own style; other songs follow the defaults', () => {
  const store = createStore()
  store.set(lyricsThemeIdAtom, 'amethyst')

  store.set(lyricsStyleSongAtom, 'songA')
  store.set(lyricsStyleScopeAtom, 'song')
  store.set(lyricsThemeIdAtom, 'matcha')
  store.set(lyricsAnchorAtom, 0.1)

  store.set(lyricsStyleSongAtom, 'songB')
  expect(store.get(lyricsThemeIdAtom)).toBe('amethyst')
  expect(store.get(lyricsAnchorAtom)).toBe(1)
  expect(store.get(lyricsStyleSourceAtom)).toBe('default')

  // A fresh store reads songA back from storage, as a reload would
  const reloaded = createStore()
  // Mounted, as the player's components mount them, so the defaults load from storage too
  reloaded.sub(lyricsThemeIdAtom, () => {})
  reloaded.sub(fontSizeMultiplierAtom, () => {})
  reloaded.set(lyricsStyleSongAtom, 'songA')
  expect(reloaded.get(lyricsThemeIdAtom)).toBe('matcha')
  expect(reloaded.get(lyricsAnchorAtom)).toBe(0.1)
  // A song with its own style opens with changes going to it
  expect(reloaded.get(lyricsStyleScopeAtom)).toBe('song')
  // Size was never changed for songA, so it still follows the default
  reloaded.set(lyricsStyleSongAtom, null)
  reloaded.set(fontSizeMultiplierAtom, 1.3)
  reloaded.set(lyricsStyleSongAtom, 'songA')
  expect(reloaded.get(fontSizeMultiplierAtom)).toBe(1.3)

  reloaded.set(resetSongLyricsStyleAtom)
  expect(reloaded.get(lyricsThemeIdAtom)).toBe('amethyst')
  expect(localStorage.getItem('lyricsStyle:songA')).toBeNull()
})

test('Save as My Default makes the song style the default', () => {
  const store = createStore()
  store.set(lyricsStyleSongAtom, 'songA')
  store.set(lyricsStyleScopeAtom, 'song')
  store.set(lyricsThemeIdAtom, 'lemon')
  store.set(applySongLyricsStyleToAllAtom)

  expect(store.get(lyricsStyleSourceAtom)).toBe('default')
  store.set(lyricsStyleSongAtom, 'songB')
  expect(store.get(lyricsThemeIdAtom)).toBe('lemon')
})

test('a corrupt or out-of-range saved style falls back to the defaults', () => {
  localStorage.setItem('lyricsStyle:bad', '{not json')
  localStorage.setItem(
    'lyricsStyle:range',
    JSON.stringify({ style: { fontSize: 99 }, updatedAt: 1, v: 1 })
  )
  const store = createStore()
  store.set(lyricsStyleSongAtom, 'bad')
  expect(store.get(lyricsThemeIdAtom)).toBe(DEFAULT_LYRICS_STYLE.themeId)
  store.set(lyricsStyleSongAtom, 'range')
  expect(store.get(fontSizeMultiplierAtom)).toBe(DEFAULT_LYRICS_STYLE.fontSize)
})

test("a shared link's style shows for the visit without touching the viewer's own", () => {
  const sent = decodeSharedStyle(
    encodeSharedStyle({
      ...DEFAULT_LYRICS_STYLE,
      anchor: 0.123,
      fontSize: 1.25,
      themeId: 'lemon',
    })
  )
  expect(sent).toMatchObject({ anchor: 0.12, fontSize: 1.25, themeId: 'lemon' })
  if (sent === null) {
    return
  }

  const store = createStore()
  store.sub(lyricsThemeIdAtom, () => {})
  store.set(lyricsStyleSongAtom, 'songA')
  store.set(lyricsThemeIdAtom, 'amethyst')
  const saved = stored()

  // Opening the link: shown, nothing stored, and the song still has no style of its own
  store.set(showSharedLyricsStyleAtom, sent)
  expect(store.get(lyricsStyleAtom)).toMatchObject({
    fontSize: 1.25,
    themeId: 'lemon',
  })
  expect(stored()).toBe(saved)
  expect(store.get(lyricsStyleSourceAtom)).toBe('default')
  expect(store.get(lyricsStyleScopeAtom)).toBe('all')

  // Another song, and the same song opened again (a reload), are the viewer's own
  store.set(lyricsStyleSongAtom, 'songB')
  expect(store.get(lyricsThemeIdAtom)).toBe('amethyst')
  const reloaded = createStore()
  reloaded.sub(lyricsThemeIdAtom, () => {})
  reloaded.set(lyricsStyleSongAtom, 'songA')
  expect(reloaded.get(lyricsThemeIdAtom)).toBe('amethyst')

  // A change while it shows: what is on screen changes, and only the changed field is saved, by the usual rules
  store.set(lyricsStyleSongAtom, 'songA')
  store.set(showSharedLyricsStyleAtom, sent)
  store.set(fontSizeMultiplierAtom, 0.8)
  expect(store.get(lyricsStyleAtom)).toMatchObject({
    fontSize: 0.8,
    themeId: 'lemon',
  })
  expect(localStorage.getItem('lyricsStyle:songA')).toBeNull()
  store.set(lyricsStyleSongAtom, 'songB')
  expect(store.get(lyricsStyleAtom)).toMatchObject({
    fontSize: 0.8,
    themeId: 'amethyst',
  })
})

test('a malformed shared style is ignored', () => {
  expect(decodeSharedStyle('1.lemon.shadow.999.10.50.200')).toBeNull()
  expect(decodeSharedStyle('2.lemon.shadow.100.10.50.200')).toBeNull()
  expect(decodeSharedStyle('garbage')).toBeNull()
})

test('two lines travel in a shared link; a one-line style stays readable by older app versions', () => {
  const twoLines = {
    ...DEFAULT_LYRICS_STYLE,
    themeId: 'lemon' as const,
    twoLines: true,
  }
  expect(decodeSharedStyle(encodeSharedStyle(twoLines))).toMatchObject({
    themeId: 'lemon',
    twoLines: true,
  })
  const oneLine = { ...twoLines, twoLines: false }
  expect(encodeSharedStyle(oneLine).startsWith('1.')).toBe(true)
  expect(decodeSharedStyle(encodeSharedStyle(oneLine))).toMatchObject({
    themeId: 'lemon',
    twoLines: false,
  })
  expect(decodeSharedStyle('2.lemon.shadow.100.10.50.200.7')).toBeNull()
})

test('two lines carry their own size in a shared link; links from before it read as two lines at the default size', () => {
  const twoLines = {
    ...DEFAULT_LYRICS_STYLE,
    fontSize: 1.4,
    fontSizeTwoLines: 1.05,
    twoLines: true,
  }
  expect(decodeSharedStyle(encodeSharedStyle(twoLines))).toMatchObject({
    fontSize: 1.4,
    fontSizeTwoLines: 1.05,
    twoLines: true,
  })
  // A two-line size off its range is not a style this app makes
  expect(decodeSharedStyle('3.lemon.shadow.100.10.50.200.30')).toBeNull()
  // Format 2: 1 was two centred lines, 2 two staggered ones; both are now the one two-line layout
  for (const lines of ['1', '2']) {
    expect(
      decodeSharedStyle(`2.lemon.shadow.100.10.50.200.${lines}`)
    ).toMatchObject({
      fontSizeTwoLines: DEFAULT_LYRICS_STYLE.fontSizeTwoLines,
      twoLines: true,
    })
  }
  expect(decodeSharedStyle('2.lemon.shadow.100.10.50.200.0')).toMatchObject({
    twoLines: false,
  })
})

test('a change carries to every song, unless the song has its own style; old saved styles load unchanged', () => {
  // Saved by the app before two lines, screen sizes and templates existed
  localStorage.setItem('lyricsTheme', JSON.stringify('aqua'))
  localStorage.setItem(
    'lyricsStyle:mv',
    JSON.stringify({
      style: { anchor: 0.2, fontSize: 0.8 },
      updatedAt: 1,
      v: 1,
    })
  )
  const store = createStore()
  store.sub(lyricsThemeIdAtom, () => {})
  store.sub(fontSizeMultiplierAtom, () => {})

  store.set(lyricsStyleSongAtom, 'songA')
  expect(store.get(lyricsStyleScopeAtom)).toBe('all')
  store.set(lyricsThemeIdAtom, 'lemon')
  store.set(fontSizeMultiplierAtom, 1.2)
  expect(localStorage.getItem('lyricsStyle:songA')).toBeNull()

  store.set(lyricsStyleSongAtom, 'mv')
  expect(store.get(lyricsStyleScopeAtom)).toBe('song')
  expect(store.get(lyricsStyleAtom)).toMatchObject({
    anchor: 0.2,
    fontSize: 0.8,
    themeId: 'lemon',
    twoLines: false,
  })
  // For All Songs, a field the song had its own value for lets go of it, so the change shows; the rest stay
  store.set(lyricsStyleScopeAtom, 'all')
  store.set(fontSizeMultiplierAtom, 1.1)
  expect(store.get(lyricsStyleAtom)).toMatchObject({
    anchor: 0.2,
    fontSize: 1.1,
  })
  expect(store.get(lyricsStyleSourceAtom)).toBe('song')
})

test('a saved style applies where changes go, and survives a reload', () => {
  const store = createStore()
  store.set(lyricsStyleSongAtom, 'songA')
  store.set(lyricsStyleScopeAtom, 'song')
  store.set(lyricsThemeIdAtom, 'matcha')
  store.set(lyricsTwoLinesAtom, true)
  store.set(saveLyricsTemplateAtom, 'Duet')
  store.set(resetSongLyricsStyleAtom)

  const reloaded = createStore()
  reloaded.set(lyricsStyleSongAtom, 'songB')
  const [duet] = reloaded.get(lyricsTemplatesAtom)
  expect(duet?.name).toBe('Duet')
  reloaded.set(applyLyricsTemplateAtom, duet?.id ?? '')
  // songB followed the default, so the saved style became the default
  expect(reloaded.get(lyricsStyleSourceAtom)).toBe('default')
  reloaded.set(lyricsStyleSongAtom, 'songC')
  expect(reloaded.get(lyricsStyleAtom)).toMatchObject({
    themeId: 'matcha',
    twoLines: true,
  })

  // One bad record drops only itself
  const saved = localStorage.getItem('lyricsTemplates') ?? ''
  localStorage.setItem(
    'lyricsTemplates',
    saved.replace('"templates":[', '"templates":[{"id":1},')
  )
  expect(
    createStore()
      .get(lyricsTemplatesAtom)
      .map((t) => t.name)
  ).toEqual(['Duet'])
})

test('a saved style shows as in use only while the style on screen matches it', () => {
  const store = createStore()
  store.set(lyricsThemeIdAtom, 'matcha')
  store.set(saveLyricsTemplateAtom, 'Green')
  const [green] = store.get(lyricsTemplatesAtom)
  const inUse = () =>
    green !== undefined &&
    sameSavedLyricsStyle(green.style, store.get(lyricsStyleAtom))
  expect(inUse()).toBe(true)

  store.set(lyricsThemeIdAtom, 'amethyst')
  expect(inUse()).toBe(false)
  store.set(applyLyricsTemplateAtom, green?.id ?? '')
  expect(inUse()).toBe(true)

  // The hue shows only on the Custom colour, so off it a different hue is the same style
  store.set(lyricsCustomHueAtom, 123)
  expect(inUse()).toBe(true)
  // A size on one screen only is part of the saved style
  store.set(lyricsScreenSizesAtom, { desktop: 1.2, landscape: 1, portrait: 1 })
  expect(inUse()).toBe(false)
})

test('Aqua, retired, reads as Frost in saved song styles and in links shared before', () => {
  localStorage.setItem(
    'lyricsStyle:mv',
    JSON.stringify({
      style: { backdrop: 'box', themeId: 'aqua' },
      updatedAt: 1,
      v: 1,
    })
  )
  const store = createStore()
  store.set(lyricsStyleSongAtom, 'mv')
  expect(store.get(lyricsStyleAtom)).toMatchObject({ themeId: 'frost' })
  // Box and Fade, retired, still open as the one backdrop there is
  expect(decodeSharedStyle('1.aqua.box.100.10.50.200')).toMatchObject({
    themeId: 'frost',
  })
})

// A fresh store over the same storage, as a reload would make, showing the given layout
const reloadIn = (theater: boolean) => {
  const store = createStore()
  store.sub(lyricsTwoLinesAtom, () => {})
  store.set(theaterShownAtom, theater)
  return store
}

test('Karaoke Style: on in Theater, off beside the video, until picked', () => {
  expect(reloadIn(false).get(lyricsTwoLinesAtom)).toBe(false)
  expect(reloadIn(true).get(lyricsTwoLinesAtom)).toBe(true)
})

test("Karaoke Style: a pick in one layout is that layout's own", () => {
  reloadIn(true).set(lyricsTwoLinesAtom, false)
  expect(reloadIn(true).get(lyricsTwoLinesAtom)).toBe(false)
  expect(reloadIn(false).get(lyricsTwoLinesAtom)).toBe(false)

  reloadIn(false).set(lyricsTwoLinesAtom, true)
  expect(reloadIn(false).get(lyricsTwoLinesAtom)).toBe(true)
  expect(reloadIn(true).get(lyricsTwoLinesAtom)).toBe(false)
})

test("Karaoke Style: the old single pick becomes the default view's", () => {
  localStorage.setItem('lyricsTwoLines', 'true')
  expect(reloadIn(false).get(lyricsTwoLinesAtom)).toBe(true)
  localStorage.setItem('lyricsTwoLines', 'false')
  expect(reloadIn(false).get(lyricsTwoLinesAtom)).toBe(false)
  expect(reloadIn(true).get(lyricsTwoLinesAtom)).toBe(true)
})
