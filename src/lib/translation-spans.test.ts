import { describe, expect, test } from 'vite-plus/test'

import { currentLineIndex } from '@/lib/karaoke'
import { isKaraokeDoc } from '@/lib/synbox-flask/api'

// The backend's v2 doc with four lines, the middle two (0.9 s and 1 s) sharing one translation. Invented text
import karaokeV2Spans from './synbox-flask/__fixtures__/karaoke-v2-spans.json'
import { translationSpans } from './translation-spans'

const doc: unknown = karaokeV2Spans
if (!(isKaraokeDoc(doc) && doc.translations.en)) {
  throw new Error('the spans fixture is not a karaoke doc with English')
}
const { lines } = doc
const english = doc.translations.en

describe('translationSpans', () => {
  test('every line of a span finds that span; the others their own', () => {
    const spans = translationSpans(english.lines, lines.length, english.spans)
    expect(spans.map((span) => [span.first, span.last])).toEqual([
      [0, 0],
      [1, 2],
      [1, 2],
      [3, 3],
    ])
    expect(spans[2].text).toBe('Running on, again and again')
  })

  test('the translation sung lines show stays the same across a span and changes when the next one starts', () => {
    const spans = translationSpans(english.lines, lines.length, english.spans)
    const shownAt = (time: number) => {
      const span = spans[currentLineIndex(lines, time)]
      return `${span.first}:${span.text}`
    }
    const across = [12.3, 12.8, 13.3, 13.6, 14.3].map(shownAt)
    expect(new Set(across)).toEqual(new Set(['1:Running on, again and again']))
    expect(shownAt(15)).toBe('3:Toward the light')
  })

  test('a doc without spans shows every line on its own, an empty line as empty', () => {
    const spans = translationSpans(english.lines, lines.length, undefined)
    expect(spans.map((span) => [span.first, span.last, span.text])).toEqual([
      [0, 0, 'Run toward tomorrow'],
      [1, 1, 'Running on, again and again'],
      [2, 2, ''],
      [3, 3, 'Toward the light'],
    ])
  })

  test('spans the lyrics row contradicts or that leave a line out are not used', () => {
    // A previewed version's row with its own text inside the live doc's span
    const ownLines = ['a', 'b', 'c', 'd']
    expect(
      translationSpans(ownLines, 4, english.spans).map((span) => span.text)
    ).toEqual(ownLines)
    // The row's text wins on a span's first line: it carries the Worker's trace mark
    const marked = ['a', 'b⁠', '', 'd']
    expect(translationSpans(marked, 4, english.spans)[2].text).toBe('b⁠')
    expect(
      translationSpans(english.lines, 5, english.spans).map((span) => span.last)
    ).toEqual([0, 1, 2, 3, 4])
  })
})
