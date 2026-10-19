import { describe, expect, test } from 'vite-plus/test'

import type { KaraokeDocLine, KaraokeToken } from '@/types'

import {
  advancePlaybackClock,
  currentLineIndex,
  FILL_WINDOW,
  fillProgress,
  karaokeMatchesLyrics,
  LINE_LEAD_IN,
  moraCharCounts,
  romajiFillParts,
  tokenFillParts,
} from './karaoke'

const mora = (kana: string, start: number, end: number, romaji = '') => ({
  end,
  kana,
  romaji,
  start,
})

const token = (
  surface: string,
  ruby: KaraokeToken['ruby'],
  morae: KaraokeToken['morae'],
  isLatin = false
): KaraokeToken => ({ is_latin: isLatin, morae, reading: '', ruby, surface })

const line = (
  tokens: KaraokeToken[],
  start = 30,
  end = 40
): KaraokeDocLine => ({
  checks: [],
  end,
  furigana: '',
  romaji: '',
  start,
  status: 'verified',
  text: tokens.map((t) => t.surface).join(''),
  tokens,
})

const W = FILL_WINDOW

describe('fillProgress', () => {
  // 誰: だ 30.8-31.05, れ 31.05-31.3
  const dare = [
    { end: 31.05, start: 30.8, weight: 1 },
    { end: 31.3, start: 31.05, weight: 1 },
  ]

  test('a mora is fully lit FILL_WINDOW after its onset, not at its end', () => {
    expect(fillProgress(dare, 30.8)).toBe(0)
    expect(fillProgress(dare, 30.8 + W / 2)).toBeCloseTo(0.25)
    expect(fillProgress(dare, 30.8 + W + 1e-9)).toBe(0.5)
    expect(fillProgress(dare, 31.05 + W + 1e-9)).toBe(1)
  })

  test('a mora shorter than the window fills over its own length', () => {
    const short = [{ end: 10.04, start: 10, weight: 1 }]
    expect(fillProgress(short, 10.02)).toBeCloseTo(0.5)
    expect(fillProgress(short, 10.04)).toBe(1)
  })

  test('weights split the width by characters, and Latin fills linearly', () => {
    const kyoku = [
      { end: 10.2, start: 10, weight: 2 },
      { end: 10.4, start: 10.2, weight: 1 },
    ]
    expect(fillProgress(kyoku, 10 + W + 1e-9)).toBeCloseTo(2 / 3)
    expect(
      fillProgress([{ end: 34, linear: true, start: 33, weight: 1 }], 33.5)
    ).toBeCloseTo(0.5)
  })
})

describe('moraCharCounts', () => {
  test('small kana join the mora before them; っ, ん and ー stand alone', () => {
    expect(moraCharCounts('きょく')).toEqual([2, 1])
    expect(moraCharCounts('ちゃん')).toEqual([2, 1])
    expect(moraCharCounts('ハート')).toEqual([1, 1, 1])
    expect(moraCharCounts('かった')).toEqual([1, 1, 1])
  })
})

describe('tokenFillParts', () => {
  // 残し from the song: 残 is read のこ, し is its okurigana
  const nokoshi = token(
    '残し',
    [
      { base: '残', rt: 'のこ' },
      { base: 'し', rt: '' },
    ],
    [mora('の', 10, 10.2), mora('こ', 10.2, 10.4), mora('し', 10.4, 10.6)]
  )

  test('a kanji and its furigana fill from that kanji’s own morae', () => {
    const [[noko, shi]] = tokenFillParts(line([nokoshi]))
    expect(noko.base).toBe('残')
    expect(fillProgress(noko.spans, 10.2)).toBe(0.5) // の lit at its end, こ not yet
    expect(fillProgress(noko.spans, 10.2 + W + 1e-9)).toBe(1)
    expect(fillProgress(shi.spans, 10.2 + W + 1e-9)).toBe(0) // し waits for its own onset
  })

  test('きょ counts as one mora across two characters', () => {
    const kyoku = token(
      '曲',
      [{ base: '曲', rt: 'きょく' }],
      [mora('きょ', 10, 10.2), mora('く', 10.2, 10.4)]
    )
    const [[part]] = tokenFillParts(line([kyoku]))
    expect(part.spans.map((s) => s.weight)).toEqual([2, 1])
  })

  test('a reading that does not match the morae falls back to the whole token', () => {
    const odd = token(
      '輝',
      [{ base: '輝', rt: 'かがや' }],
      [mora('か', 10, 10.2)]
    )
    const [[part]] = tokenFillParts(line([odd]))
    expect(part.spans).toHaveLength(1)
  })

  test('punctuation snaps to filled once the text before it has filled', () => {
    const parts = tokenFillParts(
      line([
        token('♪', [], []),
        token(
          '空',
          [{ base: '空', rt: 'そら' }],
          [mora('そ', 30.8, 31.05), mora('ら', 31.05, 31.3)]
        ),
        token('、', [], []),
      ])
    )
    const at = (time: number) => parts.map(([p]) => fillProgress(p.spans, time))
    expect(at(29.9)).toEqual([0, 0, 0])
    expect(at(30)).toEqual([1, 0, 0])
    expect(at(31.2)[2]).toBe(0)
    expect(at(31.3)).toEqual([1, 1, 1])
  })
})

describe('romajiFillParts', () => {
  test('one part per sung word, each mora weighted by its letters', () => {
    const parts = romajiFillParts(
      line([
        token(
          '君',
          [{ base: '君', rt: 'きみ' }],
          [mora('き', 10, 10.2, 'ki'), mora('み', 10.2, 10.4, 'mi')]
        ),
        token('、', [], []),
        token('Lemon', [], [mora('Lemon', 11, 12, 'lemon')], true),
      ])
    )
    expect(parts.map((p) => p.base)).toEqual(['kimi', 'Lemon'])
    expect(fillProgress(parts[0].spans, 10 + W + 1e-9)).toBe(0.5)
    expect(fillProgress(parts[1].spans, 11.5)).toBeCloseTo(0.5)
  })
})

describe('currentLineIndex', () => {
  const lines = [
    { end: 12, start: 10 },
    { end: 15, start: 12.2 },
    { end: 25, start: 20 },
  ]

  test('shows the next line LINE_LEAD_IN early, unless the previous one is still sung', () => {
    expect(currentLineIndex(lines, 9.4)).toBe(-1)
    expect(currentLineIndex(lines, 10 - LINE_LEAD_IN)).toBe(0)
    expect(currentLineIndex(lines, 11.9)).toBe(0) // line 1's lead-in, but line 0 still sung
    expect(currentLineIndex(lines, 12.05)).toBe(1)
    expect(currentLineIndex(lines, 17)).toBe(-1) // a gap between lines
    expect(currentLineIndex(lines, 20 - LINE_LEAD_IN)).toBe(2)
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
