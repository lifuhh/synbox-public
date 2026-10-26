import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type { ReactNode, Ref, RefObject } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { z } from 'zod'

import type { KaraokeLineHandle } from '@/components/lyrics-display/karaoke-line'
import { KaraokeLine } from '@/components/lyrics-display/karaoke-line'
import { KaraokeRomajiLine } from '@/components/lyrics-display/karaoke-romaji-line'
import { RubyText } from '@/components/lyrics-display/ruby-text'
import {
  fontSizeMultiplierAtom,
  lyricsFontSizeTwoLinesAtom,
  lyricsCustomHueAtom,
  lyricsScreenSizesAtom,
  lyricsThemeIdAtom,
  lyricsTwoLinesAtom,
  lyricsVisibilityAtom,
  romajiVisibilityAtom,
  translationIsEnglishAtom,
  translationVisibilityAtom,
  lyricsTranslationAnchorAtom,
  positionsResetAtAtom,
  lyricsAnchorAtom,
  lyricsAnchorPortraitAtom,
  translationDockedAtom,
  lyricsStylePanelAtom,
} from '@/context/atoms'
import { useLyricsSurface, usePortrait } from '@/hooks/use-media-query'
import { balanceWrap } from '@/lib/balance-wrap'
import { parseRubyHtml } from '@/lib/furigana'
import type { PlaybackClock, TwoLineView } from '@/lib/karaoke'
import {
  advancePlaybackClock,
  currentLineIndex,
  karaokeMatchesLyrics,
  twoLineView,
} from '@/lib/karaoke'
import type { TimedLyrics } from '@/lib/lyrics-document'
import { parseLyricsDocument } from '@/lib/lyrics-document'
import {
  lyricsScaleOn,
  rowsBoost,
  SCREEN_SIZE_MAX,
  SCREEN_SIZE_MIN,
  TWO_LINES_SIZE_RANGE,
} from '@/lib/lyrics-style'
import { getLyricsThemeColors } from '@/lib/lyrics-themes'
import type { LyricsThemeColors } from '@/lib/lyrics-themes'
import { pagePoint } from '@/lib/page-turn'
import {
  useGetKaraokeById,
  useGetLyricsBySongId,
  useGetLyricsVersion,
} from '@/lib/react-query/queries-and-mutations'
import type { ProbeSample } from '@/lib/timing-probe'
import { summarizeProbe, timingProbeEnabled } from '@/lib/timing-probe'
import type { CssVars, KaraokeDocLine } from '@/types'
import { spaceDashes } from '@/utils'
import { cn } from '@/utils/cn'

import type { Dock } from './draggable-lyrics'
import {
  clamp01,
  DraggableLyrics,
  handleTrack,
  offsetIn,
  swallowNextClick,
} from './draggable-lyrics'
import type { StageLayout } from './player-stage'
import { clearOfRows, textSpansOf, upperLineFloor } from './two-line-layout'
import { useRowsBoost } from './use-rows-boost'
import type { StagePlayer } from './use-you-tube-player'

// Fields read before (or without) a full parse; a missing or malformed field
// reads as absent rather than failing the others
const optionalText = z
  .unknown()
  .transform((value) => (typeof value === 'string' ? value : undefined))
const lyricsTextSchema = z.object({
  labelled_full_lyrics: optionalText,
  plain_lyrics: optionalText,
  romaji: optionalText,
})
export interface LyricsText {
  labelled_full_lyrics?: string
  plain_lyrics?: string
  romaji?: string
}
export const parseLyricsText = (data: unknown): LyricsText => {
  const result = lyricsTextSchema.safeParse(data)
  return result.success ? result.data : {}
}
// Everything the overlay draws runs this far ahead of the player's clock: on a device the lyrics read
// 100–200 ms behind the voice, from the embed reporting its time late and the frame it takes to paint
const LYRICS_LEAD_SEC = 0.15

const findLineIndex = (lines: TimedLyrics['lines'], time: number) =>
  lines.findIndex((line) => time >= line.startSeconds && time < line.endSeconds)

const JAPANESE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/u
const LATIN = /[a-zA-Z]/u
const isLatinOnly = (html: string) => {
  const text = html.replaceAll(/<[^>]*>/gu, '')
  return LATIN.test(text) && !JAPANESE.test(text)
}

// A line's text without its markup and furigana, as wide as it draws
const plainText = (html: string) =>
  html
    .replaceAll(/<(?<tag>rt|rp)>.*?<\/\k<tag>>/gu, '')
    .replaceAll(/<[^>]*>/gu, '')

// Every line's text per row, for useRowsBoost
const rowTextsOf = (
  lyrics: TimedLyrics | null,
  karaokeLines: KaraokeDocLine[] | null,
  english: boolean,
  count: number
) => {
  const translations = (english ? lyrics?.eng : lyrics?.chi) ?? []
  return {
    japanese: Array.from({ length: count }, (_, index) =>
      plainText(karaokeLines?.[index]?.text ?? lyrics?.lines[index]?.text ?? '')
    ),
    romaji: Array.from(
      { length: count },
      (_, index) => karaokeLines?.[index]?.romaji ?? lyrics?.romaji[index] ?? ''
    ),
    translation: Array.from(
      { length: count },
      (_, index) => translations[index] ?? ''
    ),
  }
}

const sameText = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

// Lyrics scale with the stage, but never below a size a phone can read
// Sizes step down as on the reader: the Japanese, then its romaji (read with it, so close in size), then the
// translation
const LINE_SIZE = {
  japanese: 'text-lyric',
  romaji: 'text-lyric-romaji',
  translation: 'text-lyric-secondary',
} as const
// Two lines' type, on their own size (see --text-lyric-stagger)
const STAGGER_SIZE = {
  japanese: 'text-lyric-stagger',
  romaji: 'text-lyric-stagger-romaji',
  translation: 'text-lyric-stagger-translation',
} as const
type LineSizes = Record<keyof typeof LINE_SIZE, string>

const LyricLine = ({
  html,
  kind,
  size = LINE_SIZE[kind],
  className,
  row,
  shown = true,
}: {
  html: string
  kind: keyof typeof LINE_SIZE
  size?: string
  className?: string
  // Which of a line's rows this is, for the one-line spacing (lyric-line-rows)
  row?: keyof typeof LINE_SIZE
  // False for a copy laid out only to be measured: the bench's first-lyric hook is for drawn lines, and the copy
  // keeps a plain wrap. Balancing never changes a line's count of rows, which is all fitSong reads, and
  // re-balancing every line of the song on each size change is hundreds of layouts a frame
  shown?: boolean
}) => {
  const segments = useMemo(() => parseRubyHtml(html), [html])
  const latin = kind !== 'japanese' || isLatinOnly(html)
  return (
    <p
      key={html}
      data-bench={shown ? 'lyrics-line' : undefined}
      data-row={row}
      ref={shown ? balanceWrap : undefined}
      className={cn(
        'lyric-text-line mx-auto text-center',
        size,
        className,
        // Room above a Japanese line for its furigana when it wraps
        latin
          ? 'font_noto_sans_reg leading-normal'
          : 'font_noto_sans_jp_black_900 leading-loose'
      )}>
      {/* Inline, so only the drawn text takes a press */}
      <span>
        <RubyText segments={segments} />
      </span>
    </p>
  )
}

const lineAt = (
  lyrics: TimedLyrics | null,
  karaokeLines: KaraokeDocLine[] | null,
  index: number,
  english: boolean,
  placeholder: string | undefined
) => {
  const karaokeLine = karaokeLines?.[index]
  const line = lyrics?.lines[index]
  const text = karaokeLine?.text ?? line?.text ?? placeholder
  const translation = spaceDashes(
    (english ? lyrics?.eng : lyrics?.chi)?.[index] ?? ''
  )
  const romaji = lyrics?.romaji[index] ?? ''
  return { karaokeLine, romaji, text, translation }
}

interface ShownRows {
  lyrics: boolean
  romaji: boolean
  translation: boolean
}

// One lyric line with the rows the viewer shows with it: its romaji, then its translation, below it. Each
// karaoke line hands its fill handle to `track` while mounted
const LineRows = ({
  line: { karaokeLine, romaji, text, translation },
  lineKey,
  shown,
  sizes,
  track,
  measured = false,
}: {
  line: ReturnType<typeof lineAt> & { text: string }
  lineKey: number
  shown: ShownRows
  sizes: LineSizes
  // None for a measured copy, whose karaoke lines are never filled
  track?: (handle: KaraokeLineHandle | null) => () => void
  measured?: boolean
}) => {
  // One line tags its rows for its own spacing (lyric-line-rows); two lines space theirs as they are
  const rowOf = (row: keyof typeof LINE_SIZE) =>
    sizes === LINE_SIZE ? row : undefined
  return (
    <>
      {shown.lyrics &&
        (karaokeLine ? (
          <div
            data-row={rowOf('japanese')}
            className={cn('text-center', sizes.japanese)}>
            <KaraokeLine
              key={lineKey}
              ref={track}
              line={karaokeLine}
              balanced={!measured}
            />
          </div>
        ) : (
          <LyricLine
            html={text}
            kind='japanese'
            size={sizes.japanese}
            row={rowOf('japanese')}
            shown={!measured}
          />
        ))}
      {shown.romaji &&
        (karaokeLine ? (
          <div
            data-row={rowOf('romaji')}
            className={cn('text-center', sizes.romaji)}>
            <KaraokeRomajiLine key={lineKey} ref={track} line={karaokeLine} />
          </div>
        ) : (
          romaji &&
          !sameText(romaji, text) && (
            <LyricLine
              html={romaji}
              kind='romaji'
              size={sizes.romaji}
              row={rowOf('romaji')}
              shown={!measured}
            />
          )
        ))}
      {shown.translation && translation && !sameText(translation, text) && (
        <LyricLine
          html={translation}
          kind='translation'
          size={sizes.translation}
          row={rowOf('translation')}
          shown={!measured}
        />
      )}
    </>
  )
}

// The least a two-line row's type shrinks to, as a share of its size, when its line runs long
const ROW_FIT_FLOOR = 0.6

// oxlint-disable-next-line unicorn/prefer-number-coercion -- the value ends in px, which Number() rejects
const pixels = (value: string) => Number.parseFloat(value) || 0

// The song's tallest line, as laid out now, and which it is; and which is the shortest with any text
const tallestLineOf = (lines: HTMLElement) => {
  let height = 0
  let index = -1
  let shortestHeight = Number.POSITIVE_INFINITY
  let shortest = -1
  for (const [at, line] of [...lines.children].entries()) {
    if (!(line instanceof HTMLElement)) {
      continue
    }
    if (line.offsetHeight > height) {
      height = line.offsetHeight
      index = at
    }
    if (line.offsetHeight > 0 && line.offsetHeight < shortestHeight) {
      shortestHeight = line.offsetHeight
      shortest = at
    }
  }
  return { height, index, shortest }
}
const tallestOf = (lines: HTMLElement) => tallestLineOf(lines).height

// The docked translation's place under Two Lines' rows: room for its song's tallest, up to two rows of text (owner,
// 2026-10-25: never seen in three), so it never pushes the rows up; a longer one shrinks into it (DockedTranslation)
const DOCKED_ROWS = 2
const dockedSlotOf = (reserve: HTMLElement) => {
  const first = reserve.firstElementChild
  const text = first?.querySelector('p')
  if (!(first instanceof HTMLElement && text)) {
    return 0
  }
  const rows =
    pixels(getComputedStyle(first).paddingTop) +
    DOCKED_ROWS * pixels(getComputedStyle(text).lineHeight)
  return Math.min(tallestOf(reserve), rows)
}

// Which of the song's lines are tallest and shortest (-1 before they are measured)
interface SongLineSizes {
  tallest: number
  shortest: number
}

// The sizes fitSong tries, as the lyrics' scale times the row fit: every Two Lines size times every screen's tweak,
// down to the floor
const FIT_RANGE = {
  max: TWO_LINES_SIZE_RANGE.max * SCREEN_SIZE_MAX,
  min: TWO_LINES_SIZE_RANGE.min * SCREEN_SIZE_MIN * ROW_FIT_FLOOR,
}
// Halvings of the gap between a size that fits and one that doesn't: from the widest gap, the whole range, to
// within half a percent of the largest size that fits
const FIT_STEPS = 9
// Between two tries on the copy while nothing waits for the answer: each lays out every line of the song
const FIT_IDLE_MS = 50

// One size for both rows, for the whole song: each row gets half the room under the translation (less, with the
// translation docked under them, its tallest line: `reserve`, every translation laid out unseen as it docks), and when the
// song's tallest line (`lines`, every line laid out unseen at a row's width) wraps taller than that,
// both rows shrink by as much. So the two lines on screen are always the same size, the rows never climb over the
// translation, and no row changes size while its line is sung. The room is the layer's, less the room kept
// under the block and the gap between the rows.
// The copy lays out at its own size (its --lyric-scale held at 1), so a size change, a slider drag's every step,
// sets the rows by arithmetic on the largest size that fits; trying a size on the copy lays out every line of the
// song. `measure` runs when the stage, the song's lines or the fonts change. The rows need only one try when the
// current size fits; the rest of the search runs one try at a time while nothing waits, or at once for a larger
// size that needs it
const fitSong = (
  grid: HTMLElement,
  lines: HTMLElement,
  reserve: HTMLElement,
  // The song's tallest and shortest lines at the size the rows get: the block holds two of the tallest, and the
  // upper line's home is a shortest line above the lower one (TwoRows)
  onLines: (lines: SongLineSizes) => void
) => {
  const block = grid.closest<HTMLElement>('.player-lyrics-overlay')
  const layer = block?.parentElement
  const lift = block?.nextElementSibling
  // The spacer over the block keeps its least height too (DraggableLyrics' EDGE), at the top of the room
  const spacer = block?.previousElementSibling
  let scale = 1
  // The largest size known to fit and the smallest known not to; `steps` halvings of the gap remain
  let fitting = Number.POSITIVE_INFINITY
  let failing = Number.POSITIVE_INFINITY
  let steps = 0
  let height = 0
  let measuredFor = ''
  let sizes: SongLineSizes = { shortest: -1, tallest: -1 }
  let idle: ReturnType<typeof setTimeout> | undefined
  const apply = () => {
    grid.style.setProperty(
      '--row-fit',
      String(Math.min(1, Math.max(ROW_FIT_FLOOR, fitting / scale)))
    )
    onLines(sizes)
  }
  // Smaller type also wraps less, so the height doesn't scale with the size: try sizes on the copy, halving the
  // gap each time. The gap between the rows is in em, so it is read at each size too
  const fits = (size: number) => {
    lines.style.setProperty('--row-fit', String(size))
    const tallest = tallestLineOf(lines)
    const fit =
      tallest.height <=
      (height - pixels(getComputedStyle(lines).rowGap)) / 2 + 1
    // Which lines are tallest and shortest barely moves between nearby sizes: the last size tried that fits, or any
    // while none does
    if (fit || sizes.tallest < 0) {
      sizes = { shortest: tallest.shortest, tallest: tallest.index }
    }
    return fit
  }
  const step = () => {
    if (steps <= 0) {
      return
    }
    steps -= 1
    if (failing === Number.POSITIVE_INFINITY) {
      if (fits(FIT_RANGE.max)) {
        fitting = Number.POSITIVE_INFINITY
        steps = 0
      } else {
        failing = FIT_RANGE.max
      }
      return
    }
    const mid = (fitting + failing) / 2
    if (fits(mid)) {
      fitting = mid
    } else {
      failing = mid
    }
  }
  const settle = () => {
    clearTimeout(idle)
    const left = steps
    for (let index = 0; index < left; index += 1) {
      step()
    }
  }
  const refineLater = () => {
    idle = setTimeout(() => {
      step()
      apply()
      if (steps > 0) {
        refineLater()
      }
    }, FIT_IDLE_MS)
  }
  const measure = () => {
    if (
      !(
        block &&
        layer &&
        lift instanceof HTMLElement &&
        spacer instanceof HTMLElement
      )
    ) {
      return
    }
    clearTimeout(idle)
    measuredFor = `${layer.clientWidth}x${layer.clientHeight}`
    const pad = getComputedStyle(block)
    const slot = dockedSlotOf(reserve)
    height =
      layer.clientHeight -
      pixels(getComputedStyle(lift).minHeight) -
      pixels(getComputedStyle(spacer).minHeight) -
      pixels(pad.paddingTop) -
      pixels(pad.paddingBottom) -
      slot
    // The docked translation's place under the rows, kept whatever it says: a longer one never moves what is above
    block.style.setProperty('--docked-h', `${slot}px`)
    if (fits(scale)) {
      fitting = scale
      failing = Number.POSITIVE_INFINITY
      // The top of the range first, then the halvings
      steps = FIT_STEPS + 1
      refineLater()
    } else {
      fitting = FIT_RANGE.min
      failing = scale
      steps = FIT_STEPS
      settle()
    }
    apply()
  }
  // The room moves with the stage, and the copy's wraps with the song's lines (romaji, a new version)
  const lineChanges = new MutationObserver(measure)
  lineChanges.observe(lines, {
    characterData: true,
    childList: true,
    subtree: true,
  })
  lineChanges.observe(reserve, { childList: true, subtree: true })
  const observer = new ResizeObserver(() => {
    if (layer && `${layer.clientWidth}x${layer.clientHeight}` !== measuredFor) {
      measure()
    }
  })
  if (layer) {
    observer.observe(layer)
  }
  document.fonts.addEventListener('loadingdone', measure)
  return {
    setScale: (next: number) => {
      scale = next
      // A docked translation's room grows and shrinks with the size
      if (reserve.childElementCount > 0) {
        measure()
      }
      if (next > fitting && steps > 0) {
        settle()
      }
      apply()
    },
    stop: () => {
      clearTimeout(idle)
      observer.disconnect()
      lineChanges.disconnect()
      document.fonts.removeEventListener('loadingdone', measure)
    },
  }
}

// One of Two Lines' lines, standing on its floor (`floorRef` places the upper one), so a line that wraps taller grows
// upward
const TwoLineRow = ({
  sung,
  start,
  lineRef,
  children,
}: {
  sung: boolean
  start: boolean
  lineRef: Ref<HTMLDivElement>
  children: ReactNode
}) => (
  <div
    ref={lineRef}
    data-lyric-row={sung ? 'sung' : 'next'}
    className={cn(
      'absolute bottom-0 transition-opacity duration-200',
      !sung && 'opacity-75',
      start
        ? 'left-0 lyric-stagger-start translate-y-[calc(-1*var(--upper-floor,0px))]'
        : 'right-0 lyric-stagger-end'
    )}>
    {children}
  </div>
)

// Two Lines, the two-way karaoke screen, built up from the floor so a line change moves as little as it can (owner,
// 2026-10-25): the lower line (at the right) stands on the rows' floor, which the docked translation's place keeps
// fixed, so its romaji never moves. The upper line (at the left) stands a one-row pair and the rows' gap above it,
// and rises only by as much as the lower line's text reaches into its own (upperLineFloor); it stays risen until
// its own line changes. The block is two of the song's tallest lines high whatever is on screen, so placing it
// moves nothing either
const TwoRows = ({
  view,
  rowsOf,
  roomOf,
  songLines,
  songTranslations,
  scale,
}: {
  view: TwoLineView
  rowsOf: (index: number) => ReactNode
  roomOf: (index: number) => ReactNode
  // Every line of the song, each at a row's width, for fitSong
  songLines: ReactNode
  // Every translation of the song as it docks under the rows, while it does; the rows leave room for the tallest
  songTranslations: ReactNode
  scale: number
}) => {
  const gridRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const reserveRef = useRef<HTMLDivElement>(null)
  const floorRef = useRef<HTMLDivElement>(null)
  const homeRef = useRef<HTMLDivElement>(null)
  const upperRef = useRef<HTMLDivElement>(null)
  const lowerRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<ReturnType<typeof fitSong> | null>(null)
  const [sizes, setSizes] = useState<SongLineSizes>({
    shortest: -1,
    tallest: -1,
  })
  const onLines = useCallback((next: SongLineSizes) => {
    setSizes((current) =>
      current.shortest === next.shortest && current.tallest === next.tallest
        ? current
        : next
    )
  }, [])
  useLayoutEffect(() => {
    const fit =
      gridRef.current && linesRef.current && reserveRef.current
        ? fitSong(
            gridRef.current,
            linesRef.current,
            reserveRef.current,
            onLines
          )
        : null
    fitRef.current = fit
    return () => {
      fit?.stop()
      fitRef.current = null
    }
  }, [onLines])
  useLayoutEffect(() => {
    fitRef.current?.setScale(scale)
  }, [scale])

  // The upper line's floor, kept while its line stays: a rise for one lower line isn't undone by the next
  const placed = useRef<{ line: number; floor: number } | null>(null)
  const [upperLine] = view.rows
  const place = useRef<((keep: boolean) => void) | null>(null)
  useLayoutEffect(() => {
    place.current = (keep: boolean) => {
      const grid = gridRef.current
      const floor = floorRef.current
      const home = homeRef.current
      const upper = upperRef.current
      const lower = lowerRef.current
      if (!(grid && floor && home && upper && lower)) {
        return
      }
      const gap = pixels(getComputedStyle(grid).rowGap)
      const next = upperLineFloor({
        gap,
        home: home.offsetHeight + gap,
        lower: textSpansOf(lower, floor),
        upper: textSpansOf(upper, upper),
      })
      const held =
        keep && placed.current?.line === upperLine
          ? Math.max(placed.current.floor, next)
          : next
      placed.current = { floor: held, line: upperLine }
      grid.style.setProperty('--upper-floor', `${held}px`)
    }
    place.current(true)
  })
  // A new width or size wraps every line anew: placed afresh. The block's width and a one-row pair's height say so
  useLayoutEffect(() => {
    const observe = (floor: HTMLElement, home: HTMLElement) => {
      let seen = ''
      const resized = new ResizeObserver(() => {
        const now = `${floor.offsetWidth}x${home.offsetHeight}`
        if (now !== seen) {
          const first = seen === ''
          seen = now
          place.current?.(first)
        }
      })
      resized.observe(floor)
      resized.observe(home)
      return () => {
        resized.disconnect()
      }
    }
    const floor = floorRef.current
    const home = homeRef.current
    return floor && home ? observe(floor, home) : undefined
  }, [])

  // Before fitSong has measured, the lines on screen stand in for the song's
  const tallest = sizes.tallest >= 0 ? sizes.tallest : Math.max(...view.rows)
  const shortest = sizes.shortest >= 0 ? sizes.shortest : tallest
  return (
    <div
      ref={gridRef}
      className={cn(
        'relative grid lyric-rows-gap lyric-stagger-rows',
        STAGGER_SIZE.japanese
      )}>
      {/* Unseen, it sets the block's height: two of the song's tallest lines and the gap between them */}
      <div
        aria-hidden
        className='invisible col-start-1 row-start-1 flex flex-col lyric-rows-gap'>
        <div className='lyric-stagger-start'>
          {tallest >= 0 && roomOf(tallest)}
        </div>
        <div className='lyric-stagger-start'>
          {tallest >= 0 && roomOf(tallest)}
        </div>
      </div>
      <div ref={floorRef} className='relative col-start-1 row-start-1'>
        {/* Unseen, a one-row pair: the upper line's home over the lower one */}
        <div
          ref={homeRef}
          aria-hidden
          className='invisible absolute bottom-0 left-0 lyric-stagger-start'>
          {shortest >= 0 && roomOf(shortest)}
        </div>
        {view.rows.map((index, row) => (
          <TwoLineRow
            // The rows are fixed places; only the lines in them change
            // oxlint-disable-next-line no-array-index-key
            key={row}
            sung={index === view.active}
            start={row === 0}
            lineRef={row === 0 ? upperRef : lowerRef}>
            {index >= 0 && rowsOf(index)}
          </TwoLineRow>
        ))}
      </div>
      {/* Laid out at the rows' width, never seen and taking no room; fitSong tries its sizes on it, at its own
          scale. The rows' size and gap, so the gap reads at the size tried */}
      <div
        aria-hidden
        className='pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden lyric-stagger-rows [--lyric-scale:1] [--row-fit:1]'>
        <div
          ref={linesRef}
          className={cn('lyric-rows-gap', STAGGER_SIZE.japanese)}>
          {songLines}
        </div>
      </div>
      <div
        aria-hidden
        className='pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden [--row-fit:1]'>
        <div ref={reserveRef}>{songTranslations}</div>
      </div>
    </div>
  )
}

// Two Lines' one translation, for the line being sung, centred, at the top of the video unless the viewer drags it
// anywhere down the stage (its place saved apart from the rows'), below the rows included. Let go over the rows it
// docks under them instead (DockedTranslation); while docked the room stays, empty, for its place when it comes
// back. With no translation to show the block stays mounted, so a drag survives a gap
const StaggerTranslation = ({
  children,
  layout,
  scale,
  colors,
  dock,
  targeted,
}: {
  children: ReactNode
  layout: StageLayout
  scale: number
  colors: LyricsThemeColors
  dock: Dock
  targeted: boolean
}) => (
  <div data-lyric-translation className='lyric-stagger-translation-area'>
    <DraggableLyrics
      layout={layout}
      scale={scale}
      colors={colors}
      anchorAtom={lyricsTranslationAnchorAtom}
      dock={dock}
      targeted={targeted}>
      {children}
    </DraggableLyrics>
  </div>
)

// How far the docked translation must be pulled off the rows, up or down, to come away: a share of the stage's
// height, never less than a fingertip's travel. Short of it the translation springs back
const pullToTear = (stageHeight: number) => Math.max(40, 0.1 * stageHeight)
// How long after Karaoke Style is switched the rows keep their centre while their size settles
const SETTLE_HOLD_MS = 1000
// How long a Reset Positions counts as the cause of a room change
const RESET_WINDOW_MS = 1000
const TAP_SLOP_PX = { mouse: 4, touch: 10 }

interface Press {
  y: number
  slop: number
  tearAt: number
  moved: boolean
}

// Karaoke Style's translation docked under the rows, centred on them: part of their block, so it moves when they are
// dragged. Its own drag pulls it off them, up or down (the rows stay); let go past pullToTear it is placed on its
// own where it was let go (`onTear`: its top there, within the lyrics' layer). `ghost`: the place it would dock,
// shown while the translation is dragged over the rows
const DockedTranslation = ({
  children,
  layout,
  ghost = false,
  onTear,
}: {
  children: ReactNode
  layout: StageLayout
  ghost?: boolean
  onTear?: (top: number) => void
}) => {
  // How far the pointer has moved it, down positive
  const [pull, setPull] = useState({ at: 0, px: 0 })
  const press = useRef<Press | null>(null)
  const setStylePanel = useSetAtom(lyricsStylePanelAtom)
  const torn = pull.at > 0 && Math.abs(pull.px) > pull.at
  const handleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Its own drag, not the rows'
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const stage = event.currentTarget.closest('[data-player-stage]')
    press.current = {
      moved: false,
      slop:
        event.pointerType === 'mouse' ? TAP_SLOP_PX.mouse : TAP_SLOP_PX.touch,
      tearAt: pullToTear(stage?.clientHeight ?? 0),
      y: pagePoint(event).y,
    }
  }
  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const start = press.current
    if (start === null) {
      return
    }
    const delta = pagePoint(event).y - start.y
    if (!start.moved) {
      if (Math.abs(delta) < start.slop) {
        return
      }
      start.moved = true
      layout.onDragChange(true)
    }
    setPull({ at: start.tearAt, px: delta })
  }
  const handleUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const start = press.current
    press.current = null
    if (start === null || (event.type === 'pointercancel' && !start.moved)) {
      return
    }
    if (start.moved) {
      layout.onDragChange(false)
      swallowNextClick()
      const element = event.currentTarget
      const layer = element.closest<HTMLElement>('[data-lyric-layer]')
      if (torn && layer !== null) {
        onTear?.(offsetIn(element, layer) + pull.px)
      }
      setPull({ at: 0, px: 0 })
    } else if (event.pointerType === 'mouse') {
      setStylePanel('pinned')
    } else {
      layout.tapStage()
    }
  }
  const pulling = pull.px !== 0
  // How far towards coming off, 0 to 1: the lift's outline firms up as the pull nears pullToTear
  const reach = pull.at > 0 ? Math.min(1, Math.abs(pull.px) / pull.at) : 0
  const vars: CssVars = {
    '--dock-pull': `${pull.px}px`,
    '--dock-reach': reach,
  }
  // A translation longer than its place shrinks into it, from its top, rather than pushing the rows up
  const placeRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const place = placeRef.current
    const text = textRef.current
    if (!(place && text)) {
      return
    }
    text.style.scale = ''
    const room =
      pixels(getComputedStyle(place).getPropertyValue('--docked-h')) -
      pixels(getComputedStyle(place).paddingTop)
    const tall = text.offsetHeight
    if (room > 0 && tall > room + 1) {
      text.style.scale = String(room / tall)
    }
  })
  return (
    <div
      ref={placeRef}
      data-docked-translation={ghost ? 'ghost' : 'docked'}
      data-pulling={pulling || undefined}
      data-torn={torn || undefined}
      className='docked-translation relative flex h-(--docked-h) items-start justify-center'>
      {/* While it is pulled, where it came from: dashed and faint, so the way back reads as a place */}
      {pulling && (
        <div
          aria-hidden
          className='docked-translation-origin pointer-events-none absolute inset-x-0 top-0 flex justify-center'>
          <div className='max-w-[85%] rounded-xl px-cqw text-center'>
            {children}
          </div>
        </div>
      )}
      <div
        style={vars}
        className={cn(
          'docked-translation-text max-w-[85%] translate-y-(--dock-pull) rounded-xl px-cqw text-center',
          ghost
            ? 'pointer-events-none'
            : 'lyrics-hit-text cursor-grab touch-none transition-fade-translate duration-200 ease-out motion-reduce:transition-none',
          pulling && 'cursor-grabbing transition-none'
        )}
        onPointerDown={ghost ? undefined : handleDown}
        onPointerMove={ghost ? undefined : handleMove}
        onPointerUp={ghost ? undefined : handleUp}
        onPointerCancel={ghost ? undefined : handleUp}>
        <div ref={textRef} className='origin-top'>
          {children}
        </div>
      </div>
    </div>
  )
}

// The sung line's translation, unless it has none or it only repeats the line
const translationOf = (
  line: ReturnType<typeof lineAt>,
  lineKey: number
): ReactNode =>
  line.translation &&
  line.text !== undefined &&
  !sameText(line.translation, line.text) ? (
    <LyricLine
      key={lineKey}
      html={line.translation}
      kind='translation'
      size={STAGGER_SIZE.translation}
      className='italic motion-safe:animate-in motion-safe:fade-in'
    />
  ) : undefined

// The least gap kept between the translation placed on its own and the rows: like DraggableLyrics' EDGE, a share of
// the stage with a floor
const clearGap = (stageHeight: number) => Math.max(8, 0.02 * stageHeight)

// The rows' handle (their drawn block, the docked translation included), and the translation's in its room
const rowsHandleOf = (layer: HTMLElement) =>
  layer.querySelector<HTMLElement>(
    '[data-lyric-rows-area] [data-lyrics-style-toggle]'
  )
const translationHandleOf = (layer: HTMLElement) =>
  layer.querySelector<HTMLElement>(
    '[data-lyric-translation] [data-lyrics-style-toggle]'
  )

// The translation on its own (`handle`) watched as it wraps taller or shorter, and as it first shows: overlapping the
// rows, it is set clear of them on the side away from them (`place`: its new anchor), or, with no room on that side
// (a layout saved overlapped before overlaps were docked), docked (`dock`). The two never stay overlapped, so
// neither covers the other's grab
const keepClearOfRows = (
  layer: HTMLElement,
  handle: HTMLElement,
  place: (anchor: number) => void,
  dock: () => void
) => {
  const observer = new ResizeObserver(() => {
    const rows = rowsHandleOf(layer)
    const track = handleTrack(handle, layer)
    if (!(rows && track) || handle.offsetHeight === 0) {
      return
    }
    const rowsTop = offsetIn(rows, layer)
    const box = { bottom: rowsTop + rows.offsetHeight, top: rowsTop }
    const top = offsetIn(handle, layer)
    if (top >= box.bottom || top + handle.offsetHeight <= box.top) {
      return
    }
    const clear = clearOfRows(
      top,
      handle.offsetHeight,
      box,
      clearGap(layer.clientHeight)
    )
    const anchor = clamp01((clear - track.base) / track.free)
    const placed = track.base + anchor * track.free
    if (placed < box.bottom && placed + handle.offsetHeight > box.top) {
      dock()
      return
    }
    place(anchor)
  })
  observer.observe(handle)
  return () => {
    observer.disconnect()
  }
}

// Calls `read` when the rows or the stage resize, and when a move's ease ends; returns the cleanup
const watchRows = (layer: HTMLElement, rows: HTMLElement, read: () => void) => {
  const observer = new ResizeObserver(read)
  observer.observe(layer)
  observer.observe(rows)
  layer.addEventListener('transitionend', read)
  return () => {
    observer.disconnect()
    layer.removeEventListener('transitionend', read)
  }
}

// Whether Karaoke Style's translation is docked under the rows (one choice for every song), whether a drag has it
// over the rows right now (where letting go docks it), and placing it on its own again. Docked, the rows' room is the
// whole stage; on its own, the translation can go anywhere on the stage and the rows keep the room under its home
// at the top. Docking or undocking, by a drag, the switch or another device, leaves the rows where they were
const useTranslationDock = (
  layerRef: RefObject<HTMLDivElement | null>,
  room: RowsRoom,
  twoLines: boolean
) => {
  const [docked, setDocked] = useAtom(translationDockedAtom)
  const setAnchor = useSetAtom(lyricsTranslationAnchorAtom)
  const resetAt = useAtomValue(positionsResetAtAtom)
  // Subscribed, not only set: a new anchor re-reads the rows' place below after they move
  const [rowsAnchor, setRowsAnchor] = useAtom(
    usePortrait() ? lyricsAnchorPortraitAtom : lyricsAnchorAtom
  )
  const [offered, setOffered] = useState(false)
  // The rows dragged over the translation on its own: it is drawn as their drop target
  const [rowsOffered, setRowsOffered] = useState(false)
  // The rows' handle's top and height at the last render, in layout units, which a page turned by Lock Landscape
  // keeps
  const rowsAt = useRef<{ top: number; height: number } | null>(null)
  // Pulled off, where the translation was let go: placed once it is back in its room, before paint, as its room
  // wraps it differently from the rows' width
  const drop = useRef<number | null>(null)
  // While the rows settle after Karaoke Style is switched, the centre they keep
  const holdCentre = useRef<{ centre: number; until: number } | null>(null)
  const holdWhileSettling = useCallback(
    (layer: HTMLElement, rows: HTMLElement) => {
      const observer = new ResizeObserver(() => {
        const hold = holdCentre.current
        if (hold === null || performance.now() > hold.until) {
          holdCentre.current = null
          return
        }
        const rowsTrack = handleTrack(rows, layer)
        if (rowsTrack) {
          setRowsAnchor(
            clamp01(
              (hold.centre - rows.offsetHeight / 2 - rowsTrack.base) /
                rowsTrack.free
            )
          )
        }
      })
      observer.observe(rows)
      return () => {
        observer.disconnect()
      }
    },
    [setRowsAnchor]
  )
  // The rows' room (and the layout) at the last render: a change of either keeps the rows where they were
  const was = useRef({ room, twoLines })
  useLayoutEffect(() => {
    const layer = layerRef.current
    const rows = layer && rowsHandleOf(layer)
    const before = was.current
    was.current = { room, twoLines }
    if (
      (before.room === room && before.twoLines === twoLines) ||
      !(layer && rows)
    ) {
      return
    }
    const rowsTrack = handleTrack(rows, layer)
    let rowsTop = offsetIn(rows, layer)
    const at = rowsAt.current
    // Reset Positions just set where everything goes: that wins over keeping the rows where they were
    const reset = performance.now() - resetAt < RESET_WINDOW_MS
    if (rowsTrack && at !== null && !reset) {
      // Switching Karaoke Style on or off swaps one line's block for two rows of another height: the block keeps its
      // centre, so the sung line stays about where it was. A room change alone keeps the rows' top, so a dock or
      // undock adds or takes the translation under them without moving them
      const switched = before.twoLines !== twoLines
      const target = switched
        ? at.top + at.height / 2 - rows.offsetHeight / 2
        : at.top
      const anchor = clamp01((target - rowsTrack.base) / rowsTrack.free)
      setRowsAnchor(anchor)
      rowsTop = rowsTrack.base + anchor * rowsTrack.free
      // Two rows settle their size a frame or more after the switch (fitSong): while they do, the block keeps the
      // centre it had, instead of growing about its anchor
      if (switched) {
        holdCentre.current = {
          centre: at.top + at.height / 2,
          until: performance.now() + SETTLE_HOLD_MS,
        }
      }
    }
    const dropped = drop.current
    drop.current = null
    const handle = translationHandleOf(layer)
    const track = handle && handleTrack(handle, layer)
    if (docked || dropped === null || !(handle && track)) {
      return
    }
    const top = clearOfRows(
      dropped,
      handle.offsetHeight,
      { bottom: rowsTop + rows.offsetHeight, top: rowsTop },
      clearGap(layer.clientHeight)
    )
    setAnchor(clamp01((top - track.base) / track.free))
  }, [docked, room, twoLines, layerRef, setAnchor, setRowsAnchor, resetAt])
  // Holding the rows' centre while they settle after Karaoke Style is switched (above). The rows' handle is one
  // element for good (DraggableLyrics stays mounted across the switch)
  useLayoutEffect(() => {
    const layer = layerRef.current
    const rows = layer && rowsHandleOf(layer)
    return layer && rows ? holdWhileSettling(layer, rows) : undefined
  }, [layerRef, holdWhileSettling])
  // Where the rows are drawn, kept for the effect above (it needs where they were before the room or the layout
  // changed). Read only when something moved or resized them: their anchor, the room, the layout, a resize of the rows
  // or the stage (full screen, a line that wraps), and the end of a move's 200ms ease (a read straight after a move
  // can catch them mid-way). At most once a frame, after paint: a read on every render forced a layout each time
  // (~600 offsetTop reads over 12 full-screen toggles, 2026-10-26)
  const frame = useRef(0)
  const readRows = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const layer = layerRef.current
      const rows = layer && rowsHandleOf(layer)
      rowsAt.current =
        layer && rows
          ? { height: rows.offsetHeight, top: offsetIn(rows, layer) }
          : null
    })
  }, [layerRef])
  useEffect(readRows, [readRows, rowsAnchor, room, twoLines])
  useEffect(() => {
    const layer = layerRef.current
    const rows = layer && rowsHandleOf(layer)
    return layer && rows ? watchRows(layer, rows, readRows) : undefined
  }, [layerRef, readRows])
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
    },
    []
  )
  // The translation on its own wraps taller or shorter as the lines change, growing about its place: next to the rows
  // that could grow it into them. When it does, it eases back clear of them, away from them, by as much (never cut
  // off: its room is the stage)
  useEffect(() => {
    const layer = layerRef.current
    const handle = layer && translationHandleOf(layer)
    // On its own only, and again when the room changes (the translation's block remounts with Karaoke Style)
    return layer && handle && room !== 'none' && room !== 'docked'
      ? keepClearOfRows(
          layer,
          handle,
          (anchor) => {
            setAnchor(anchor)
          },
          () => {
            setDocked(true)
          }
        )
      : undefined
  }, [room, layerRef, setAnchor, setDocked])
  const handleTear = (top: number) => {
    drop.current = top
    setDocked(false)
  }
  const rowsBox = () => {
    const layer = layerRef.current
    const rows = layer && rowsHandleOf(layer)
    if (!(layer && rows)) {
      return null
    }
    const top = offsetIn(rows, layer)
    return { bottom: top + rows.offsetHeight, layer, top }
  }
  // The translation on its own, where it is drawn
  const translationBox = () => {
    const layer = layerRef.current
    const handle = layer && translationHandleOf(layer)
    if (!(layer && handle) || handle.offsetHeight === 0) {
      return null
    }
    const top = offsetIn(handle, layer)
    return { bottom: top + handle.offsetHeight, top }
  }
  const pull: Dock = {
    onDrop: (over, handle) => {
      if (over) {
        setDocked(true)
        return
      }
      const box = rowsBox()
      const track = box && handleTrack(handle, box.layer)
      if (!(box && track)) {
        return
      }
      const top = offsetIn(handle, box.layer)
      const clear = clearOfRows(
        top,
        handle.offsetHeight,
        box,
        clearGap(box.layer.clientHeight)
      )
      if (clear === top) {
        return
      }
      const anchor = clamp01((clear - track.base) / track.free)
      // No room to set it clear (the rows reach the stage's edge on that side): overlapping them, it docks, as the
      // rows let go over it do
      const placed = track.base + anchor * track.free
      if (placed < box.bottom && placed + handle.offsetHeight > box.top) {
        setDocked(true)
        return
      }
      setAnchor(anchor)
    },
    onOver: setOffered,
    // The translation's centre over the rows' drawn block
    over: () => {
      const box = rowsBox()
      const own = translationBox()
      if (!(box && own)) {
        return false
      }
      const centre = (own.top + own.bottom) / 2
      return centre >= box.top && centre <= box.bottom
    },
  }
  // The rows dragged onto the translation on its own dock it as surely as the other way round: any overlap, since
  // the rows are the larger block and couldn't be set clear of it the way the translation is
  const rowsPull: Dock = {
    onDrop: (over) => {
      if (over) {
        setDocked(true)
      }
    },
    onOver: setRowsOffered,
    over: () => {
      const box = rowsBox()
      const own = translationBox()
      return (
        box !== null &&
        own !== null &&
        own.bottom > box.top &&
        own.top < box.bottom
      )
    },
  }
  return { docked, handleTear, offered, pull, rowsOffered, rowsPull }
}

// Under the rows: the docked translation, or while a drag has it over the rows, its place there
const UnderRows = ({
  dock,
  layout,
  children,
}: {
  dock: ReturnType<typeof useTranslationDock>
  layout: StageLayout
  children: ReactNode
}) => {
  if (children === undefined) {
    return null
  }
  if (dock.docked) {
    return (
      <DockedTranslation layout={layout} onTear={dock.handleTear}>
        {children}
      </DockedTranslation>
    )
  }
  // Over the stage under the rows, taking no room: the rows stay put until it is let go
  return dock.offered ? (
    <div className='relative h-0'>
      <div className='absolute inset-x-0 top-0'>
        <DockedTranslation layout={layout} ghost>
          {children}
        </DockedTranslation>
      </div>
    </div>
  ) : null
}

// Which room Two Lines' rows move in (globals.css › lyric-stagger-area): under the translation's home at the top
// (`split`), or the whole stage, with the translation docked under them (`docked`) or placed away from its home
// (`free`: nothing at the top to keep clear of, so the rows go up as far as they like)
type RowsRoom = 'none' | 'split' | 'docked' | 'free'
// Under this anchor the translation counts as at its home at the top
const TRANSLATION_HOME = 0.02
const rowsRoomFor = (
  translated: boolean,
  docked: boolean,
  translationAnchor: number
): RowsRoom => {
  if (!translated) {
    return 'none'
  }
  if (docked) {
    return 'docked'
  }
  return translationAnchor > TRANSLATION_HOME ? 'free' : 'split'
}
const rowsRoomOf = (room: RowsRoom) => ({
  'data-docked': room === 'docked' || room === 'free' || undefined,
  'data-translation': room === 'split' || undefined,
})

const NO_VIEW: TwoLineView = { active: -1, rows: [-1, -1] }
const sameView = (a: TwoLineView, b: TwoLineView) =>
  a.active === b.active && a.rows[0] === b.rows[0] && a.rows[1] === b.rows[1]

export const StageLyrics = ({
  videoId,
  player,
  layout,
  version = null,
  placeholder,
}: {
  videoId: string
  player: StagePlayer
  layout: StageLayout
  // A saved lyrics version to preview instead of the song's active lyrics
  version?: number | null
  placeholder?: string
}) => {
  const { data: activeLyrics } = useGetLyricsBySongId(
    version === null ? videoId : ''
  )
  const { data: versionLyrics } = useGetLyricsVersion(videoId, version)
  const data = version === null ? activeLyrics : versionLyrics
  const lyrics = useMemo(() => parseLyricsDocument(data), [data])
  const [view, setView] = useState(NO_VIEW)
  const showView = useCallback((next: TwoLineView) => {
    setView((current) => (sameView(current, next) ? current : next))
  }, [])

  // v2 timing applies only when it was generated for exactly these lines
  const { data: karaokeDoc } = useGetKaraokeById(videoId, version)
  const plainLyrics = useMemo(() => parseLyricsText(data).plain_lyrics, [data])
  const karaokeLines = useMemo(
    () =>
      karaokeDoc && karaokeMatchesLyrics(karaokeDoc.lines, plainLyrics)
        ? karaokeDoc.lines
        : null,
    [karaokeDoc, plainLyrics]
  )
  // The fill handles of the karaoke lines on screen, set from the frame loop
  const handlesRef = useRef(new Set<KaraokeLineHandle>())
  const track = useCallback((handle: KaraokeLineHandle | null) => {
    const handles = handlesRef.current
    if (handle !== null) {
      handles.add(handle)
    }
    return () => {
      if (handle !== null) {
        handles.delete(handle)
      }
    }
  }, [])
  const clockRef = useRef<PlaybackClock | null>(null)
  const playingRef = useRef(false)
  const playing = player.phase.kind === 'playing'
  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  const showLyrics = useAtomValue(lyricsVisibilityAtom)
  const showRomaji = useAtomValue(romajiVisibilityAtom)
  const showTranslation = useAtomValue(translationVisibilityAtom)
  const english = useAtomValue(translationIsEnglishAtom)
  const surface = useLyricsSurface()
  const oneLineSize = useAtomValue(fontSizeMultiplierAtom)
  const twoLinesSize = useAtomValue(lyricsFontSizeTwoLinesAtom)
  const screenSize = useAtomValue(lyricsScreenSizesAtom)[surface]
  const themeId = useAtomValue(lyricsThemeIdAtom)
  const hue = useAtomValue(lyricsCustomHueAtom)
  // Upright, a phone's lines wrap at its narrow width and the band under the video also holds the controls,
  // so two lines (each with its romaji and translation) would crowd it: one line there
  const twoLines = useAtomValue(lyricsTwoLinesAtom) && surface !== 'portrait'
  // Each layout's own size for every screen, times this screen's own optional tweak, within the screen's range
  const scale = lyricsScaleOn(
    surface,
    twoLines,
    twoLines ? twoLinesSize : oneLineSize,
    screenSize
  )
  const colors = useMemo(
    () => getLyricsThemeColors(themeId, hue),
    [themeId, hue]
  )

  const plainSpans = useMemo(
    () =>
      lyrics?.lines.map((line) => ({
        end: line.endSeconds,
        start: line.startSeconds,
      })) ?? [],
    [lyrics]
  )

  const { subscribeFrame } = player
  // ?timingProbe=1: one recording per page, across line changes
  const probeRef = useRef<ProbeSample[] | null>(null)
  useEffect(() => {
    if (!timingProbeEnabled() || probeRef.current !== null) {
      return
    }
    const samples: ProbeSample[] = []
    probeRef.current = samples
    Reflect.set(window, '__synboxTimingProbe', {
      player: () =>
        Object.defineProperties(
          {},
          {
            currentTime: {
              configurable: true,
              enumerable: true,
              get: () => player.getTime(),
            },
            paused: {
              configurable: true,
              enumerable: true,
              get: () => !playingRef.current,
            },
          }
        ),
      samples,
      summary: () => summarizeProbe(samples),
    })
  }, [player])

  useEffect(() => {
    if (karaokeLines) {
      return subscribeFrame((reported) => {
        // YouTube reports time in steps; the clock smooths it for the fill
        clockRef.current = advancePlaybackClock(clockRef.current, {
          mediaTime: reported,
          now: performance.now(),
          playing: playingRef.current,
          rate: 1,
        })
        const time = clockRef.current.time + LYRICS_LEAD_SEC
        probeRef.current?.push({
          clock: clockRef.current.time,
          now: performance.now(),
          playing: playingRef.current,
          reported,
        })
        if (twoLines) {
          showView(twoLineView(karaokeLines, time))
        } else {
          const index = currentLineIndex(karaokeLines, time)
          showView({ active: index, rows: [index, -1] })
        }
        for (const handle of handlesRef.current) {
          handle.setTime(time)
        }
      })
    }
    return lyrics
      ? subscribeFrame((reported) => {
          const time = reported + LYRICS_LEAD_SEC
          if (twoLines) {
            // Plain lines have no lead-in: each one runs until the next one starts
            showView(twoLineView(plainSpans, time, 0))
          } else {
            const index = findLineIndex(lyrics.lines, time)
            showView({ active: index, rows: [index, -1] })
          }
        })
      : undefined
  }, [lyrics, plainSpans, karaokeLines, subscribeFrame, twoLines, showView])

  const shown: ShownRows = {
    lyrics: showLyrics,
    romaji: showRomaji,
    translation: showTranslation,
  }
  // Two lines keep the translation out of the rows, for its own place at the top
  const rowShown = twoLines ? { ...shown, translation: false } : shown
  // Nothing between lines: DraggableLyrics keeps its block mounted but hidden
  const rowsOf = (index: number) => {
    const line = lineAt(lyrics, karaokeLines, index, english, placeholder)
    return line.text === undefined ? undefined : (
      <LineRows
        line={{ ...line, text: line.text }}
        lineKey={index}
        shown={rowShown}
        sizes={twoLines ? STAGGER_SIZE : LINE_SIZE}
        track={track}
      />
    )
  }
  // Two lines size both rows to the song's tallest line: every line, laid out once per song and look
  const lineCount = karaokeLines?.length ?? lyrics?.lines.length ?? 0
  // A line as Two Lines lays it out, untimed: for measuring, and for the room each row keeps
  const quietRowsOf = useCallback(
    (index: number) => {
      const line = lineAt(lyrics, karaokeLines, index, english, undefined)
      return (
        line.text !== undefined && (
          <LineRows
            line={{ ...line, text: line.text }}
            lineKey={index}
            shown={{
              lyrics: showLyrics,
              romaji: showRomaji,
              translation: false,
            }}
            sizes={STAGGER_SIZE}
            measured
          />
        )
      )
    },
    [lyrics, karaokeLines, english, showLyrics, showRomaji]
  )
  const songLines = useMemo(
    () =>
      Array.from({ length: twoLines ? lineCount : 0 }, (_, index) => (
        // Lines are positional and never reorder
        // oxlint-disable-next-line no-array-index-key
        <div key={index} className='lyric-stagger-start'>
          {quietRowsOf(index)}
        </div>
      )),
    [twoLines, lineCount, quietRowsOf]
  )
  const docked = useAtomValue(translationDockedAtom)
  const songTranslations = useMemo(
    () =>
      Array.from(
        { length: twoLines && showTranslation && docked ? lineCount : 0 },
        (_, index) => {
          const translation = translationOf(
            lineAt(lyrics, karaokeLines, index, english, undefined),
            index
          )
          return (
            translation !== undefined && (
              // Lines are positional and never reorder
              // oxlint-disable-next-line no-array-index-key
              <div
                key={index}
                className='docked-translation flex justify-center'>
                <div className='max-w-[85%] px-cqw text-center'>
                  {translation}
                </div>
              </div>
            )
          )
        }
      ),
    [
      twoLines,
      showTranslation,
      docked,
      lineCount,
      lyrics,
      karaokeLines,
      english,
    ]
  )
  // Rows hidden, the rows still shown grow: one line's only as far as the song's lines stay within what all three
  // rows take (useRowsBoost); two lines' as far as fitSong finds room for them
  const layerRef = useRef<HTMLDivElement>(null)
  const rowTexts = useMemo(
    () => rowTextsOf(lyrics, karaokeLines, english, lineCount),
    [lyrics, karaokeLines, english, lineCount]
  )
  useRowsBoost(layerRef, {
    enabled: !twoLines,
    shown,
    texts: rowTexts,
    wanted: rowsBoost(shown, false),
  })
  const layerVars: CssVars = {
    '--lyric-glow': colors.glow,
    // Two lines' rows; one line's is --lyric-line-boost, which useRowsBoost sets
    '--lyric-rows-boost': rowsBoost(shown, true),
    '--lyric-scale': scale,
  }
  // Karaoke Style's translation: in its room at the top, or docked under the rows
  const translated = twoLines && showTranslation
  const translationLine = translationOf(
    lineAt(lyrics, karaokeLines, view.active, english, placeholder),
    view.active
  )
  const translationAnchor = useAtomValue(lyricsTranslationAnchorAtom)
  const room = rowsRoomFor(translated, docked, translationAnchor)
  const dock = useTranslationDock(layerRef, room, twoLines)
  const underRows = translated && (
    <UnderRows dock={dock} layout={layout}>
      {translationLine}
    </UnderRows>
  )
  return (
    <div
      ref={layerRef}
      data-lyric-layer
      className='absolute inset-0 lyric-stagger-layer'
      style={layerVars}>
      {translated && (
        <StaggerTranslation
          layout={layout}
          scale={scale}
          colors={colors}
          dock={dock.pull}
          targeted={dock.rowsOffered}>
          {dock.docked ? undefined : translationLine}
        </StaggerTranslation>
      )}
      {/* Always this box, so the lyrics stay mounted when two lines turn on or off; two lines move only in
          the stage's lower part, under their translation */}
      <div
        data-lyric-rows-area
        {...rowsRoomOf(room)}
        className={cn(
          'absolute inset-x-0 bottom-0',
          twoLines ? 'lyric-stagger-area' : 'top-0'
        )}>
        <DraggableLyrics
          layout={layout}
          scale={scale}
          colors={colors}
          wide={twoLines}
          dock={translated && !dock.docked ? dock.rowsPull : undefined}
          targeted={dock.offered}>
          {twoLines && view.active >= 0 ? (
            <>
              <TwoRows
                view={view}
                rowsOf={rowsOf}
                roomOf={quietRowsOf}
                songLines={songLines}
                songTranslations={songTranslations}
                scale={scale}
              />
              {underRows}
            </>
          ) : (
            rowsOf(view.active)
          )}
        </DraggableLyrics>
      </div>
    </div>
  )
}
