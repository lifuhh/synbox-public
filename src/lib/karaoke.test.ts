import { describe, expect, test } from 'vite-plus/test'

import type { KaraokeDocLine } from '@/types'

import {
  advancePlaybackClock,
  fillProgress,
  karaokeMatchesLyrics,
  tokenFillSpans,
} from './karaoke'

// 誰: だ 30.8-31.05, れ 31.05-31.3; then a gap; 輝: か 31.5-31.7
const dare = [
  { end: 31.05, start: 30.8 },
  { end: 31.3, start: 31.05 },
]

describe('fillProgress', () => {
  test('is 0 before the first mora and 1 after the last', () => {
    expect(fillProgress(dare, 30)).toBe(0)
    expect(fillProgress(dare, 30.8)).toBe(0)
    expect(fillProgress(dare, 31.3)).toBe(1)
    expect(fillProgress(dare, 99)).toBe(1)
  })

  test('fills evenly inside a mora, each mora an equal share', () => {
    expect(fillProgress(dare, 30.925)).toBeCloseTo(0.25)
    expect(fillProgress(dare, 31.05)).toBeCloseTo(0.5)
    expect(fillProgress(dare, 31.175)).toBeCloseTo(0.75)
  })

  test('holds the reached share across a gap between morae', () => {
    const gapped = [
      { end: 31, start: 30 },
      { end: 33, start: 32 },
    ]
    expect(fillProgress(gapped, 31.5)).toBe(0.5)
    expect(fillProgress(gapped, 32.5)).toBeCloseTo(0.75)
  })
})

describe('tokenFillSpans', () => {
  const token = (surface: string, morae: typeof dare) => ({
    is_latin: false,
    morae: morae.map((m) => ({ ...m, kana: '', romaji: '' })),
    reading: '',
    ruby: [{ base: surface, rt: '' }],
    surface,
  })
  const line: KaraokeDocLine = {
    checks: [],
    end: 32,
    furigana: '',
    romaji: '',
    start: 30,
    status: 'verified',
    text: '♪誰、輝',
    tokens: [
      token('♪', []),
      token('誰', dare),
      token('、', []),
      token('輝', [{ end: 31.7, start: 31.5 }]),
    ],
  }

  test('snaps empty-morae tokens to filled when the text before them ends', () => {
    const spans = tokenFillSpans(line)
    const at = (time: number) => spans.map((s) => fillProgress(s, time))
    expect(at(29.9)).toEqual([0, 0, 0, 0])
    expect(at(30)).toEqual([1, 0, 0, 0])
    expect(at(31.2)[2]).toBe(0)
    expect(at(31.3)).toEqual([1, 1, 1, 0])
  })
})

describe('advancePlaybackClock', () => {
  const play = { playing: true, rate: 1 }

  test('advances on wall time between reports, capped while stalled', () => {
    let clock = advancePlaybackClock(null, { ...play, mediaTime: 10, now: 0 })
    clock = advancePlaybackClock(clock, { ...play, mediaTime: 10, now: 200 })
    expect(clock.time).toBeCloseTo(10.2)
    clock = advancePlaybackClock(clock, { ...play, mediaTime: 10, now: 5000 })
    expect(clock.time).toBeCloseTo(10.5)
  })

  test('holds on small backward jitter, jumps on a seek back, follows pause', () => {
    let clock = advancePlaybackClock(null, { ...play, mediaTime: 10, now: 0 })
    clock = advancePlaybackClock(clock, { ...play, mediaTime: 10, now: 200 })
    clock = advancePlaybackClock(clock, { ...play, mediaTime: 10.1, now: 210 })
    expect(clock.time).toBeCloseTo(10.2)
    clock = advancePlaybackClock(clock, { ...play, mediaTime: 4, now: 220 })
    expect(clock.time).toBe(4)
    clock = advancePlaybackClock(clock, {
      mediaTime: 3,
      now: 230,
      playing: false,
      rate: 1,
    })
    expect(clock.time).toBe(3)
  })
})

describe('karaokeMatchesLyrics', () => {
  const lines = [{ text: '誰よりも' }, { text: '輝く君を' }]

  test('applies timing only to the lyrics version it was made for', () => {
    expect(
      karaokeMatchesLyrics(lines, JSON.stringify(['誰よりも', '輝く君を']))
    ).toBe(true)
    expect(
      karaokeMatchesLyrics(lines, JSON.stringify(['誰よりも', '輝く君を見て']))
    ).toBe(false)
    expect(karaokeMatchesLyrics(lines, JSON.stringify(['誰よりも']))).toBe(
      false
    )
  })

  test('is false for missing or malformed lyrics', () => {
    expect(karaokeMatchesLyrics(lines, undefined)).toBe(false)
    expect(karaokeMatchesLyrics(lines, 'not json')).toBe(false)
  })
})
