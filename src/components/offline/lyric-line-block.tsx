import type { Ref } from 'react'
import { useImperativeHandle, useRef } from 'react'

import type { KaraokeLineHandle } from '@/components/lyrics-display/karaoke-line'
import { RubyText } from '@/components/lyrics-display/ruby-text'
import {
  translationParts,
  TranslationRows,
} from '@/components/lyrics-display/translation-rows'
import type { OfflineLine } from '@/lib/offline/song'
import { spaceDashes } from '@/utils'
import { cn } from '@/utils/cn'

import { ReaderKaraokeLine } from './reader-karaoke-line'

// One sung line as the reader draws it, wherever lyrics are read along: the reader page and the watch page's
// lyrics. Sizes step down from the Japanese (17 bold) to the romaji (15 medium, upright, in the page's ink,
// as important as the Japanese for a singer) to the translation (14 italic), and synced karaoke fills the
// Japanese and the romaji together. Colours come from the --reader-* variables of the surface it sits on
// The Japanese and the romaji of a line: each filled as it is sung when synced and timed, else plain text.
// Bold Japanese, medium romaji and a regular italic translation set the three lines apart
const LineJapanese = ({
  line,
  synced,
  bold,
  karaokeRef,
}: {
  line: OfflineLine
  synced: boolean
  bold: boolean
  karaokeRef: Ref<KaraokeLineHandle>
}) => {
  const className = cn(
    'font-reader text-reader-ja',
    bold ? 'font-extrabold' : 'font-bold'
  )
  return synced && line.karaoke !== null ? (
    <ReaderKaraokeLine
      ref={karaokeRef}
      kind='japanese'
      line={line.karaoke}
      className={className}
    />
  ) : (
    <p lang='ja' className={cn(className, 'text-(--reader-accent)')}>
      <RubyText segments={line.ruby} />
    </p>
  )
}

const LineRomaji = ({
  line,
  synced,
  bold,
  karaokeRef,
}: {
  line: OfflineLine
  synced: boolean
  bold: boolean
  karaokeRef: Ref<KaraokeLineHandle>
}) => {
  const className = cn(
    'text-reader-romaji',
    bold ? 'font-semibold' : 'font-medium'
  )
  return synced && line.karaoke !== null ? (
    <ReaderKaraokeLine
      ref={karaokeRef}
      kind='romaji'
      line={line.karaoke}
      className={className}
    />
  ) : (
    <p className={className}>{line.romaji}</p>
  )
}

// One sung line as a block: the Japanese, its romaji, then the translation. Synced, a tap on its text seeks to
// it (where the surface seeks on a tap), the line being sung is the bright one, and its Japanese and romaji fill as they are sung
export interface LineShow {
  japanese: boolean
  romaji: boolean
  translation: boolean
  language: 'en' | 'zh'
  bold: boolean
}

// Where a line stands once the song plays: sung, being sung (or the last one sung, through a gap), or to come
export type LinePhase = 'past' | 'current' | 'upcoming'

// null until the song has started: nothing is sung yet, and the whole song reads at full strength
export const linePhase = (
  index: number,
  lit: number,
  started: boolean
): LinePhase | null => {
  if (!started) {
    return null
  }
  if (index === lit) {
    return 'current'
  }
  return index < lit ? 'past' : 'upcoming'
}

// A line's place in its translation span (lineSpans): up to three short lines read as one unit, set close
// together, with their one translation after the last
export interface LineInSpan {
  // Before the span's last line: no translation of its own, and only the span's gap below
  continues: boolean
  // After the span's first line: never a stanza break above it
  continued: boolean
  // The span holds more than one line
  shared: boolean
  // When the span's first line is sung: a tap on its translation plays from there
  start: number
  // The translation's own phase: lit while any line of the span is
  phase: LinePhase | null
}

export const lineInSpan = (
  lines: readonly OfflineLine[],
  spans: readonly { first: number; last: number }[],
  index: number,
  lit: number,
  started: boolean
): LineInSpan => {
  const { first, last } = spans[index] ?? { first: index, last: index }
  let phase: LinePhase | null = null
  if (started) {
    if (lit >= first && lit <= last) {
      phase = 'current'
    } else {
      phase = lit > last ? 'past' : 'upcoming'
    }
  }
  return {
    continued: index > first,
    continues: index < last,
    phase,
    shared: last > first,
    start: lines[first]?.start ?? 0,
  }
}

const LineTranslation = ({
  text,
  show,
  apart,
  lit,
  ref,
}: {
  text: string
  show: LineShow
  apart: boolean
  lit: boolean
  ref: Ref<HTMLParagraphElement>
}) => (
  <p
    ref={ref}
    lang={show.language}
    data-lit={lit || undefined}
    className={cn(
      show.language === 'zh' ? 'font-reader-zh' : 'font-reader',
      // Even rows, never a one-word last row; a split one ("\n") breaks there when it needs two rows
      'text-reader-translation text-balance italic',
      // A little apart, so the romaji reads as part of the Japanese above it
      apart && 'pt-1',
      show.bold ? 'font-medium' : 'font-normal'
    )}>
    <TranslationRows parts={translationParts(text)} />
  </p>
)

// The room around a line: a span's lines sit as close as a line's own translation sits to it, so the span reads
// as one unit, and with no Japanese or romaji shown the lines before its translation take no room at all. A
// stanza break never falls inside a span
const lineRoom = ({
  span,
  source,
  stanza,
}: {
  span: LineInSpan
  source: boolean
  stanza: boolean
}) =>
  cn(
    span.continues ? source && 'pb-reader-span' : 'pb-reader-line',
    stanza && !span.continued && 'pt-reader-stanza'
  )

export const LyricLineBlock = ({
  show: prefs,
  line,
  first,
  span,
  synced,
  phase,
  blockRef,
  karaokeRef,
  onSeek,
}: {
  show: LineShow
  line: OfflineLine
  first: boolean
  span: LineInSpan
  synced: boolean
  phase: LinePhase | null
  blockRef: (element: HTMLDivElement | null) => void
  karaokeRef: Ref<KaraokeLineHandle>
  onSeek?: (time: number) => void
}) => {
  const seeks = synced && onSeek !== undefined
  const translation = span.continues
    ? ''
    : spaceDashes(prefs.language === 'en' ? line.en : line.zh)
  const source = prefs.japanese || (prefs.romaji && line.romaji !== '')
  const translationRef = useRef<HTMLParagraphElement>(null)
  // The clock drives one handle per line; it fills the Japanese and the romaji together
  const japanese = useRef<KaraokeLineHandle>(null)
  const romaji = useRef<KaraokeLineHandle>(null)
  useImperativeHandle(karaokeRef, () => ({
    setTime: (time: number) => {
      japanese.current?.setTime(time)
      romaji.current?.setTime(time)
    },
  }))
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a tap seeks; the position bar does the same from the keyboard
    <div
      ref={blockRef}
      data-bench='lyrics-text'
      data-phase={phase ?? undefined}
      onClick={
        seeks
          ? (event) => {
              // A span's translation is the whole span's: it plays from the span's first line
              const target = event.target instanceof Node ? event.target : null
              onSeek(
                translationRef.current?.contains(target) === true
                  ? span.start
                  : line.start
              )
            }
          : undefined
      }
      className={cn(
        'grid gap-y-0.5 transition-opacity duration-300',
        lineRoom({ source, span, stanza: line.stanza && !first }),
        // Only the drawn text seeks: a thumb landing beside or between lines while scrolling must not jump
        // the song
        seeks &&
          'pointer-events-none justify-items-start *:pointer-events-auto *:cursor-pointer',
        // Dimmed to --reader-dim (globals.css): the lowest strength its text still reads at 4.5:1
        phase === 'past' && 'opacity-(--reader-dim)',
        // A line to come dims piece by piece: its karaoke text already draws unsung at the strength the rest
        // dims to (globals.css, reader-karaoke-part) and stays as it is when the line is reached; only the
        // other text brightens then
        // A span's translation stays bright while any of its lines is sung (data-lit)
        '*:transition-opacity *:duration-300 data-[phase=upcoming]:*:not-has-[.reader-karaoke-part]:not-data-lit:opacity-(--reader-dim)'
      )}>
      {source && (
        <div>
          {prefs.japanese && (
            <LineJapanese
              line={line}
              synced={synced}
              bold={prefs.bold}
              karaokeRef={japanese}
            />
          )}
          {prefs.romaji && line.romaji !== '' && (
            <LineRomaji
              line={line}
              synced={synced}
              bold={prefs.bold}
              karaokeRef={romaji}
            />
          )}
        </div>
      )}
      {prefs.translation && translation !== '' && (
        <LineTranslation
          ref={translationRef}
          text={translation}
          show={prefs}
          apart={source}
          lit={span.shared && span.phase === 'current'}
        />
      )}
    </div>
  )
}
