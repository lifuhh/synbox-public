import type { Ref } from 'react'
import { useImperativeHandle, useRef } from 'react'

import type { KaraokeLineHandle } from '@/components/lyrics-display/karaoke-line'
import { RubyText } from '@/components/lyrics-display/ruby-text'
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

export const LyricLineBlock = ({
  show: prefs,
  line,
  first,
  synced,
  phase,
  blockRef,
  karaokeRef,
  onSeek,
}: {
  show: LineShow
  line: OfflineLine
  first: boolean
  synced: boolean
  phase: LinePhase | null
  blockRef: (element: HTMLDivElement | null) => void
  karaokeRef: Ref<KaraokeLineHandle>
  onSeek?: (time: number) => void
}) => {
  const seeks = synced && onSeek !== undefined
  const translation = spaceDashes(prefs.language === 'en' ? line.en : line.zh)
  const source = prefs.japanese || (prefs.romaji && line.romaji !== '')
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
          ? () => {
              onSeek(line.start)
            }
          : undefined
      }
      className={cn(
        'grid gap-y-0.5 pb-reader-line transition-opacity duration-300',
        line.stanza && !first && 'pt-reader-stanza',
        // Only the drawn text seeks: a thumb landing beside or between lines while scrolling must not jump
        // the song
        seeks &&
          'pointer-events-none justify-items-start *:pointer-events-auto *:cursor-pointer',
        phase === 'past' && 'opacity-40',
        // A line to come dims piece by piece: its karaoke text already draws unsung at the strength the rest
        // dims to (globals.css, reader-karaoke-part) and stays as it is when the line is reached; only the
        // other text brightens then
        '*:transition-opacity *:duration-300 data-[phase=upcoming]:*:not-has-[.reader-karaoke-part]:opacity-40'
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
        <p
          lang={prefs.language}
          className={cn(
            prefs.language === 'zh' ? 'font-reader-zh' : 'font-reader',
            'text-reader-translation italic',
            // A little apart, so the romaji reads as part of the Japanese above it
            source && 'pt-1',
            prefs.bold ? 'font-medium' : 'font-normal'
          )}>
          {translation}
        </p>
      )}
    </div>
  )
}
