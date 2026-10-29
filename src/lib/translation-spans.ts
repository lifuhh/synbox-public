import { z } from 'zod'

// One translation shown for lyric lines `first` to `last`, both included: a line on its own, or a run of short
// lines translated together because they read badly one by one
export interface TranslationSpan {
  first: number
  last: number
  text: string
}

const spansSchema = z
  .array(z.object({ first: z.int(), last: z.int(), text: z.string() }))
  .min(1)

const blank = (text = '') => text.trim() === ''

// The doc's spans when they cover lines 0 to count - 1 exactly once, in order, and the lyrics row agrees (a line
// inside a span has no translation of its own there); else null. A previewed version can come with the live doc
const checkedSpans = (
  value: unknown,
  perLine: readonly string[],
  count: number
) => {
  const parsed = spansSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }
  let next = 0
  for (const { first, last } of parsed.data) {
    if (
      first !== next ||
      last < first ||
      !perLine.slice(first + 1, last + 1).every((text) => blank(text))
    ) {
      return null
    }
    next = last + 1
  }
  return next === count ? parsed.data : null
}

// Each of a song's `count` lines' span, by line index. `perLine` is the lyrics row's translation column (a span's
// text on its first line, '' on the others), which carries the Worker's trace mark, so a span's text comes from it;
// the doc's `spans` only say which lines go together. Without spans every line is its own span, as before them
export const translationSpans = (
  perLine: readonly string[],
  count: number,
  docSpans: unknown
): TranslationSpan[] => {
  const spans = checkedSpans(docSpans, perLine, count) ?? []
  return Array.from({ length: count }, (_, line) => {
    const span = spans.find(({ last }) => line <= last)
    return span
      ? {
          ...span,
          text: blank(perLine[span.first])
            ? span.text
            : (perLine[span.first] ?? ''),
        }
      : { first: line, last: line, text: perLine[line] ?? '' }
  })
}
