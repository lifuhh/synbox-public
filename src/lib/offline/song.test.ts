// @vitest-environment happy-dom
import { describe, expect, test } from 'vite-plus/test'

import type { TimedLyrics } from '@/lib/lyrics-document'
import { isKaraokeDoc } from '@/lib/synbox-flask/api'

// The backend's v2 doc with four lines, the middle two sharing one translation. Invented text
import karaokeV2Spans from '../synbox-flask/__fixtures__/karaoke-v2-spans.json'
import { lineSpans, offlineLines } from './song'

const doc: unknown = karaokeV2Spans
if (!(isKaraokeDoc(doc) && doc.translations.en)) {
  throw new Error('the spans fixture is not a karaoke doc with English')
}
const english = doc.translations.en

// The lyrics row for the doc's lines: the per-line form, a span's text on its first line and '' after it
const lyrics: TimedLyrics = {
  chi: doc.lines.map(() => ''),
  eng: english.lines,
  lines: doc.lines.map((line) => ({
    endSeconds: line.end,
    startSeconds: line.start,
    text: line.text,
  })),
  romaji: doc.lines.map(() => 'asu e hashiru'),
}

const shown = (lines: ReturnType<typeof offlineLines>) =>
  lines.map((line) => [line.en, line.continues?.en ?? false])

describe('offlineLines', () => {
  test("a span's translation goes after its last line, and the lines before it continue into it", () => {
    const lines = offlineLines(lyrics, doc)
    expect(shown(lines)).toEqual([
      ['Run toward tomorrow', false],
      ['', true],
      ['Running on, again and again', false],
      ['Toward the light', false],
    ])
    expect(lineSpans(lines, 'en', true)).toEqual([
      { first: 0, last: 0 },
      { first: 1, last: 2 },
      { first: 1, last: 2 },
      { first: 3, last: 3 },
    ])
    // Nothing ties the lines together with the translation hidden, nor in a language without that span
    expect(lineSpans(lines, 'en', false)[1]).toEqual({ first: 1, last: 1 })
    expect(lineSpans(lines, 'zh', true)[1]).toEqual({ first: 1, last: 1 })
  })

  test('without the doc (or one for other lyrics) every line keeps its own translation, as before spans', () => {
    expect(shown(offlineLines(lyrics, null))).toEqual([
      ['Run toward tomorrow', false],
      ['Running on, again and again', false],
      ['', false],
      ['Toward the light', false],
    ])
  })

  test("a run's translation that only repeats its lines is dropped; the lines then stand alone", () => {
    const repeated = {
      ...lyrics,
      eng: ['', '明日へ走る 明日へ走る', '', ''],
    }
    const spans = [
      { first: 0, last: 0, text: '' },
      { first: 1, last: 2, text: '明日へ走る 明日へ走る' },
      { first: 3, last: 3, text: '' },
    ]
    const lines = offlineLines(repeated, {
      ...doc,
      translations: { en: { ...english, spans } },
    })
    expect(lines[2].en).toBe('')
    expect(lineSpans(lines, 'en', true)[1]).toEqual({ first: 1, last: 1 })
  })
})
