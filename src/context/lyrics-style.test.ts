// @vitest-environment happy-dom
import { createStore } from 'jotai'
import { beforeEach, expect, test } from 'vite-plus/test'

import {
  DEFAULT_LYRICS_STYLE,
  decodeSharedStyle,
  encodeSharedStyle,
} from '@/lib/lyrics-style'

import {
  applySongLyricsStyleToAllAtom,
  fontSizeMultiplierAtom,
  lyricsAnchorAtom,
  lyricsStyleSongAtom,
  lyricsThemeIdAtom,
  dismissSharedLyricsStyleAtom,
  keepSharedLyricsStyleAtom,
  lyricsStyleSourceAtom,
  resetSongLyricsStyleAtom,
  showSharedLyricsStyleAtom,
} from './atoms'

beforeEach(() => {
  localStorage.clear()
})

test('a song keeps its own style; other songs follow the defaults', () => {
  const store = createStore()
  store.set(lyricsThemeIdAtom, 'aqua')

  store.set(lyricsStyleSongAtom, 'songA')
  store.set(lyricsThemeIdAtom, 'matcha')
  store.set(lyricsAnchorAtom, 0.1)

  store.set(lyricsStyleSongAtom, 'songB')
  expect(store.get(lyricsThemeIdAtom)).toBe('aqua')
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
  // Size was never changed for songA, so it still follows the default
  reloaded.set(lyricsStyleSongAtom, null)
  reloaded.set(fontSizeMultiplierAtom, 1.3)
  reloaded.set(lyricsStyleSongAtom, 'songA')
  expect(reloaded.get(fontSizeMultiplierAtom)).toBe(1.3)

  reloaded.set(resetSongLyricsStyleAtom)
  expect(reloaded.get(lyricsThemeIdAtom)).toBe('aqua')
  expect(localStorage.getItem('lyricsStyle:songA')).toBeNull()
})

test('Use For All Songs makes the song style the default', () => {
  const store = createStore()
  store.set(lyricsStyleSongAtom, 'songA')
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
  expect(store.get(lyricsThemeIdAtom)).toBe('sakura')
  store.set(lyricsStyleSongAtom, 'range')
  expect(store.get(fontSizeMultiplierAtom)).toBe(1)
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
  store.set(lyricsStyleSongAtom, 'songA')
  store.set(lyricsThemeIdAtom, 'aqua')

  store.set(showSharedLyricsStyleAtom, sent)
  expect(store.get(lyricsThemeIdAtom)).toBe('lemon')
  expect(store.get(lyricsStyleSourceAtom)).toBe('shared')
  store.set(dismissSharedLyricsStyleAtom)
  expect(store.get(lyricsThemeIdAtom)).toBe('aqua')

  // Tuning a shared style keeps it, with the change, as the song's own
  store.set(showSharedLyricsStyleAtom, sent)
  store.set(fontSizeMultiplierAtom, 0.8)
  expect(store.get(lyricsStyleSourceAtom)).toBe('song')
  expect(store.get(lyricsThemeIdAtom)).toBe('lemon')
  expect(store.get(fontSizeMultiplierAtom)).toBe(0.8)

  store.set(lyricsStyleSongAtom, 'songB')
  store.set(showSharedLyricsStyleAtom, sent)
  store.set(keepSharedLyricsStyleAtom)
  store.set(lyricsStyleSongAtom, 'songB')
  expect(store.get(lyricsThemeIdAtom)).toBe('lemon')
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
  expect(decodeSharedStyle(encodeSharedStyle(twoLines))).toEqual(twoLines)
  const oneLine = { ...twoLines, twoLines: false }
  expect(encodeSharedStyle(oneLine).startsWith('1.')).toBe(true)
  expect(decodeSharedStyle(encodeSharedStyle(oneLine))).toEqual(oneLine)
  expect(decodeSharedStyle('2.lemon.shadow.100.10.50.200.7')).toBeNull()
})
