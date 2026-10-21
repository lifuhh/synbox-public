import { describe, expect, test } from 'vite-plus/test'

import type { KaraokeDocLine, KaraokeToken } from '@/types'

import {
  advancePlaybackClock,
  currentLineIndex,
  FILL_LEAD,
  FILL_MAX,
  FILL_MIN,
  fillProgress,
  karaokeMatchesLyrics,
  LINE_HOLD,
  LINE_LEAD_IN,
  moraCharCounts,
  romajiFillParts,
  tokenFillParts,
  twoLineView,
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

const L = FILL_LEAD

describe('fillProgress', () => {
  test('fills each share linearly over its ramp and holds across a rest', () => {
    const spans = [
      { end: 11, start: 10, weight: 1 },
      { end: 13, start: 12, weight: 3 },
    ]
    expect(fillProgress(spans, 10)).toBe(0)
    expect(fillProgress(spans, 10.5)).toBeCloseTo(0.125)
    expect(fillProgress(spans, 11.5)).toBe(0.25)
    expect(fillProgress(spans, 12.5)).toBeCloseTo(0.625)
    expect(fillProgress(spans, 13)).toBe(1)
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

  test('sung morae fill continuously: the fill never stops between them', () => {
    const [[noko, shi]] = tokenFillParts(line([nokoshi]))
    const total = (time: number) =>
      (2 * fillProgress(noko.spans, time) + fillProgress(shi.spans, time)) / 3
    let previous = total(10 - L)
    for (let time = 10 - L + 0.02; time < 10.6 - L; time += 0.02) {
      expect(total(time)).toBeGreaterThan(previous)
      previous = total(time)
    }
  })

  test('the fill leads each mora by FILL_LEAD, so a kanji is half lit on time', () => {
    const [[noko, shi]] = tokenFillParts(line([nokoshi]))
    expect(fillProgress(noko.spans, 10 - L)).toBe(0)
    // の done as こ begins
    expect(fillProgress(noko.spans, 10.2 - L)).toBe(0.5)
    expect(fillProgress(noko.spans, 10.4 - L)).toBe(1)
    // し waits for its own ramp
    expect(fillProgress(shi.spans, 10.4 - L)).toBe(0)
  })

  test('a held note fills in FILL_MAX, a very short mora in FILL_MIN', () => {
    const held = token('あ', [{ base: 'あ', rt: '' }], [mora('あ', 10, 13)])
    const [[part]] = tokenFillParts(line([held]))
    expect(part.spans[0].end - part.spans[0].start).toBeCloseTo(FILL_MAX)
    const quick = token('た', [{ base: 'た', rt: '' }], [mora('た', 10, 10.03)])
    const [[fast]] = tokenFillParts(line([quick]))
    expect(fast.spans[0].end - fast.spans[0].start).toBeCloseTo(FILL_MIN)
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
    expect(at(31.2 - L)[2]).toBe(0)
    expect(at(31.3 - L)).toEqual([1, 1, 1])
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
    expect(fillProgress(parts[0].spans, 10.2 - L)).toBe(0.5)
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
    // line 1's lead-in, but line 0 still sung
    expect(currentLineIndex(lines, 11.9)).toBe(0)
    expect(currentLineIndex(lines, 12.05)).toBe(1)
    // an instrumental break: line 1 clears LINE_HOLD after its last mora
    expect(currentLineIndex(lines, 15 + LINE_HOLD - 0.1)).toBe(1)
    expect(currentLineIndex(lines, 15 + LINE_HOLD)).toBe(-1)
    expect(currentLineIndex(lines, 20 - LINE_LEAD_IN)).toBe(2)
    // the song's last line clears the same way
    expect(currentLineIndex(lines, 25 + LINE_HOLD - 0.1)).toBe(2)
    expect(currentLineIndex(lines, 25 + LINE_HOLD)).toBe(-1)
  })

  test('a held last word keeps its line up until the next line takes over', () => {
    // The aligner ended the held note at 12; the singer holds it until ~13.8
    const held = [
      { end: 12, start: 10 },
      { end: 17, start: 14 },
    ]
    expect(currentLineIndex(held, 12.5)).toBe(0)
    expect(currentLineIndex(held, 13.4)).toBe(0)
    expect(currentLineIndex(held, 14 - LINE_LEAD_IN)).toBe(1)
  })
})

describe('twoLineView', () => {
  const lines = [
    { end: 12, start: 10 },
    { end: 14, start: 12.2 },
    { end: 16, start: 14.2 },
    // an instrumental break before line 3
    { end: 32, start: 30 },
    { end: 34, start: 32.2 },
  ]

  test('a sung line keeps its row; its old row takes the line after next', () => {
    expect(twoLineView(lines, 11)).toEqual({ active: 0, rows: [0, 1] })
    expect(twoLineView(lines, 13)).toEqual({ active: 1, rows: [2, 1] })
    // the passage's last line leaves the other row empty
    expect(twoLineView(lines, 15)).toEqual({ active: 2, rows: [2, -1] })
    expect(twoLineView(lines, 25).rows).toEqual([-1, -1])
  })

  test('a passage after an instrumental break starts in the top row', () => {
    expect(twoLineView(lines, 30 - LINE_LEAD_IN)).toEqual({
      active: 3,
      rows: [3, 4],
    })
    expect(twoLineView(lines, 33)).toEqual({ active: 4, rows: [-1, 4] })
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
