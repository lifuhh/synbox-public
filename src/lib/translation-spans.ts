import type { KaraokeTranslationSpan } from '@/types'

// One translation shown for lyric lines `first` to `last`, both included: a line on its own, or a run of short
// lines translated together because they read badly one by one
export interface TranslationSpan {
  first: number
  last: number
  text: string
}

const isSpan = (value: unknown): value is KaraokeTranslationSpan =>
  typeof value === 'object' &&
  value !== null &&
  'first' in value &&
  'last' in value &&
  'text' in value &&
  Number.isInteger(value.first) &&
  Number.isInteger(value.last) &&
  typeof value.text === 'string'

const blank = (text: string | undefined) => (text ?? '').trim() === ''

// The doc's spans when they cover lines 0 to count - 1 exactly once, in order, and the lyrics row agrees (a line
// inside a span has no translation of its own there); else null. A previewed version can come with the live doc
const checkedSpans = (
  spans: unknown,
  perLine: readonly string[],
  count: number
) => {
  if (!(Array.isArray(spans) && spans.length > 0)) {
    return null
  }
  const checked: KaraokeTranslationSpan[] = []
  let next = 0
  for (const span of spans) {
    if (!(isSpan(span) && span.first === next && span.last >= span.first)) {
      return null
    }
    for (let line = span.first + 1; line <= span.last; line += 1) {
      if (!blank(perLine[line])) {
        return null
      }
    }
    checked.push(span)
    next = span.last + 1
  }
  return next === count ? checked : null
}

// Each of a song's `count` lines' span, by line index. `perLine` is the lyrics row's translation column (a span's
// text on its first line, '' on the others), which carries the Worker's trace mark, so a span's text comes from it;
// the doc's `spans` only say which lines go together. Without spans every line is its own span, as before them
export const translationSpans = (
  perLine: readonly string[],
  count: number,
  docSpans: unknown
): TranslationSpan[] => {
  const spans = checkedSpans(docSpans, perLine, count)
  if (spans === null) {
    return Array.from({ length: count }, (_, line) => ({
      first: line,
      last: line,
      text: perLine[line] ?? '',
    }))
  }
  return spans.flatMap(({ first, last, text }) => {
    const span = {
      first,
      last,
      text: blank(perLine[first]) ? text : (perLine[first] ?? text),
    }
    return Array.from({ length: last - first + 1 }, () => span)
  })
}
