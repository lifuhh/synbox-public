// @vitest-environment happy-dom
import { createStore } from 'jotai'
import { beforeEach, expect, test } from 'vite-plus/test'

import {
  applySongLyricsStyleToAllAtom,
  fontSizeMultiplierAtom,
  lyricsAnchorAtom,
  lyricsStyleSongAtom,
  lyricsThemeIdAtom,
  resetSongLyricsStyleAtom,
  songHasOwnLyricsStyleAtom,
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
  expect(store.get(lyricsAnchorAtom)).toBe(0.85)
  expect(store.get(songHasOwnLyricsStyleAtom)).toBe(false)

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

  expect(store.get(songHasOwnLyricsStyleAtom)).toBe(false)
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
