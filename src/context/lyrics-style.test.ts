// @vitest-environment happy-dom
import { createStore } from 'jotai'
import { beforeEach, expect, test } from 'vite-plus/test'

import {
  DEFAULT_LYRICS_STYLE,
  decodeSharedStyle,
  encodeSharedStyle,
} from '@/lib/lyrics-style'

import {
  fontSizeMultiplierAtom,
  lyricsAnchorAtom,
  lyricsPositionsDraggedAtom,
  lyricsPositionsMovedAtom,
  lyricsStyleAtom,
  lyricsStyleScopeAtom,
  lyricsStyleSongAtom,
  lyricsThemeIdAtom,
  lyricsTwoLinesAtom,
  lyricsStyleSourceAtom,
  resetLyricsPositionsAtom,
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

  // Choosing All Songs lets the song's own style go, and its Undo brings it back
  const undo = reloaded.set(lyricsStyleScopeAtom, 'all')
  expect(reloaded.get(lyricsThemeIdAtom)).toBe('amethyst')
  expect(localStorage.getItem('lyricsStyle:songA')).toBeNull()
  undo?.()
  expect(reloaded.get(lyricsThemeIdAtom)).toBe('matcha')
  expect(reloaded.get(lyricsStyleScopeAtom)).toBe('song')
  expect(localStorage.getItem('lyricsStyle:songA')).not.toBeNull()
})

test('All Songs on a song with its own style lets a shared style showing go too, and saves none of it', () => {
  const sent = decodeSharedStyle(
    encodeSharedStyle({ ...DEFAULT_LYRICS_STYLE, themeId: 'lemon' })
  )
  const store = createStore()
  store.set(lyricsStyleSongAtom, 'songA')
  store.set(lyricsStyleScopeAtom, 'song')
  store.set(lyricsAnchorAtom, 0.3)
  if (sent !== null) {
    store.set(showSharedLyricsStyleAtom, sent)
  }
  expect(store.get(lyricsThemeIdAtom)).toBe('lemon')
  store.set(lyricsStyleScopeAtom, 'all')
  expect(store.get(lyricsThemeIdAtom)).toBe(DEFAULT_LYRICS_STYLE.themeId)
  expect(localStorage.getItem('lyricsStyle:songA')).toBeNull()
})

test('choosing This Song or All Songs on a song without its own style drops nothing', () => {
  const store = createStore()
  store.set(lyricsThemeIdAtom, 'lemon')
  store.set(lyricsStyleSongAtom, 'songA')
  expect(store.set(lyricsStyleScopeAtom, 'song')).toBeNull()
  expect(store.get(lyricsThemeIdAtom)).toBe('lemon')
  expect(store.set(lyricsStyleScopeAtom, 'all')).toBeNull()
  expect(store.get(lyricsThemeIdAtom)).toBe('lemon')
})

test('Reset Positions is offered only after the listener moved something, never for a place the app nudged', () => {
  const store = createStore()
  store.set(lyricsStyleSongAtom, 'songA')
  expect(store.get(lyricsPositionsMovedAtom)).toBe(false)
  // The app rewrites the anchor (Karaoke Style's switch keeps the rows' centre): not offered
  store.set(lyricsAnchorAtom, 0.92)
  expect(store.get(lyricsPositionsMovedAtom)).toBe(false)
  // The listener's drop
  store.set(lyricsAnchorAtom, 0.4)
  store.set(lyricsPositionsDraggedAtom, true)
  expect(store.get(lyricsPositionsMovedAtom)).toBe(true)
  // Reset clears it, and its Undo brings both back
  const undo = store.set(resetLyricsPositionsAtom)
  expect(store.get(lyricsPositionsMovedAtom)).toBe(false)
  undo()
  expect(store.get(lyricsAnchorAtom)).toBe(0.4)
  expect(store.get(lyricsPositionsMovedAtom)).toBe(true)
})

test('a device from before the dragged flag counts places already away from their start as moved', () => {
  localStorage.setItem('lyricsAnchor', '0.5')
  const moved = createStore()
  moved.sub(lyricsAnchorAtom, () => {})
  moved.set(lyricsStyleSongAtom, 'songA')
  expect(moved.get(lyricsPositionsDraggedAtom)).toBe(true)
  expect(moved.get(lyricsPositionsMovedAtom)).toBe(true)

  localStorage.clear()
  const untouched = createStore()
  untouched.set(lyricsStyleSongAtom, 'songA')
  expect(untouched.get(lyricsPositionsDraggedAtom)).toBe(false)
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
  // Choosing All Songs puts the song back on the viewer's default, and a change then reaches it too
  store.set(lyricsStyleScopeAtom, 'all')
  store.set(fontSizeMultiplierAtom, 1.1)
  expect(store.get(lyricsStyleAtom)).toMatchObject({
    anchor: DEFAULT_LYRICS_STYLE.anchor,
    fontSize: 1.1,
  })
  expect(store.get(lyricsStyleSourceAtom)).toBe('default')
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
