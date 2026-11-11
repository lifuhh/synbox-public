// @vitest-environment happy-dom
import { describe, expect, test } from 'vite-plus/test'

import type { TimedLyrics } from '@/lib/lyrics-document'
import { isKaraokeDoc } from '@/lib/synbox-flask/api'

// The backend's v2 doc with four lines, the middle two sharing one translation. Invented text
import karaokeV2Spans from '../synbox-flask/__fixtures__/karaoke-v2-spans.json'
import { offlineLines } from './song'

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

describe('offlineLines', () => {
  test("every line of a span shows the span's whole translation", () => {
    expect(offlineLines(lyrics, doc).map((line) => line.en)).toEqual([
      'Run toward tomorrow',
      'Running on, again and again',
      'Running on, again and again',
      'Toward the light',
    ])
  })

  test('without the doc (or one for other lyrics) every line keeps its own translation, as before spans', () => {
    expect(offlineLines(lyrics, null).map((line) => line.en)).toEqual([
      'Run toward tomorrow',
      'Running on, again and again',
      '',
      'Toward the light',
    ])
  })

  test("a run's translation that only repeats its lines is dropped from each of them", () => {
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
    expect([lines[1].en, lines[2].en]).toEqual(['', ''])
  })
})
