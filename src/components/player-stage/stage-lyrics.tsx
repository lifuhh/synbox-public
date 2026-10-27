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
  lyricsPositionsDraggedAtom,
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
  anchorForTop,
  clamp01,
  DraggableLyrics,
  floorTrackOf,
  handleTrack,
  offsetIn,
  swallowNextClick,
} from './draggable-lyrics'
import type { StageLayout } from './player-stage'
import type { Span } from './two-line-layout'
import {
  outsideOf,
  overBlock,
  textSpansOf,
  upperLineFloor,
} from './two-line-layout'
import { useRowsBoost } from './use-rows-boost'
import type { StagePlayer } from './use-you-tube-player'
import { engineRate } from './youtube-engine'

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
// 100–200 ms behind the voice, from the embed reporting its time late and the frame it takes to paint. That delay is
// real time, so slowed playback covers less of the song in it (lyricsLead)
const LYRICS_LEAD_SEC = 0.15
export const lyricsLead = (rate: number) => LYRICS_LEAD_SEC * rate

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

// The song's tallest line's height, as laid out now; and which is the shortest with any text
const tallestLineOf = (lines: HTMLElement) => {
  let height = 0
  let shortestHeight = Number.POSITIVE_INFINITY
  let shortest = -1
  for (const [at, line] of [...lines.children].entries()) {
    if (!(line instanceof HTMLElement)) {
      continue
    }
    height = Math.max(height, line.offsetHeight)
    if (line.offsetHeight > 0 && line.offsetHeight < shortestHeight) {
      shortestHeight = line.offsetHeight
      shortest = at
    }
  }
  return { height, shortest }
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

// The sizes fitSong tries, as the lyrics' scale times the row fit: every Two Lines size times every screen's tweak,
// down to the floor
const FIT_RANGE = {
  max: TWO_LINES_SIZE_RANGE.max * SCREEN_SIZE_MAX,
  min: TWO_LINES_SIZE_RANGE.min * SCREEN_SIZE_MIN * ROW_FIT_FLOOR,
}
// Halvings of the gap between a size that fits and one that doesn't: from the widest gap, the whole range, to
// within half a percent of the largest size that fits
const FIT_STEPS = 9
// How close the search gets to the largest size that fits: the whole range halved FIT_STEPS times
const FIT_PRECISION = (FIT_RANGE.max - FIT_RANGE.min) / 2 ** FIT_STEPS
// Between two tries on the copy while nothing waits for the answer: each lays out every line of the song
const FIT_IDLE_MS = 50

// One size for both rows, for the whole song, docked or not: each row gets half the room, less the docked
// translation's place under them while the translation shows (`reserve`, every translation laid out unseen as it
// docks), and when the song's tallest line (`lines`, every line laid out unseen at a row's width) wraps taller than
// that, both rows shrink by as much. So the two lines on screen are always the same size, docking never resizes the
// rows, and no row changes size while its line is sung: wherever the floor is, two of the song's tallest lines and
// the docked place fit between the top edge and the foot. The room is the layer's, less the room kept above and
// under the block and the gap between the rows.
// The copy lays out at its own size (its --lyric-scale held at 1), so a size change, a slider drag's every step,
// sets the rows by arithmetic on the largest size that fits; trying a size on the copy lays out every line of the
// song. `measure` runs when the stage, the song's lines or the fonts change. The rows need only one try when the
// current size fits; the rest of the search runs one try at a time while nothing waits, or at once for a larger
// size that needs it.
// What a try measures (the tallest line and the gap at a size) doesn't depend on the room, so it is kept per size
// until the copy's lines, the stage or the fonts change. A size change resizes the docked translation's place, and so
// the room: it reads only that place and re-judges the sizes already tried, never re-laying out the song per step
// (2026-10-27-fix-size-drag-fit)
const fitSong = (
  grid: HTMLElement,
  lines: HTMLElement,
  reserve: HTMLElement,
  // The song's shortest line at the size the rows get (-1 before it is measured): the upper line's home is one
  // above the lower one (TwoRows)
  onShortest: (shortest: number) => void
) => {
  const block = grid.closest<HTMLElement>('.player-lyrics-overlay')
  const layer = block?.parentElement
  // The docked place's height goes where the spacer under the block reads it too (globals.css › lyrics-floor)
  const area = grid.closest<HTMLElement>('[data-lyric-rows-area]')
  const lift = block?.nextElementSibling
  // The spacer over the block keeps its least height too (DraggableLyrics' EDGE), at the top of the room
  const spacer = block?.previousElementSibling
  let scale = 1
  // The largest size known to fit and the smallest known not to; `steps` halvings of the gap remain
  let fitting = Number.POSITIVE_INFINITY
  let failing = Number.POSITIVE_INFINITY
  let steps = 0
  let height = 0
  // The docked translation's place last read, already taken out of `height`
  let slot = 0
  let measuredFor = ''
  let shortestLine = -1
  // Each size tried on the copy: its tallest line, which is shortest, and the gap between the rows
  const tried = new Map<
    number,
    { tallest: number; shortest: number; gap: number }
  >()
  let idle: ReturnType<typeof setTimeout> | undefined
  let resized: ReturnType<typeof setTimeout> | undefined
  const apply = () => {
    grid.style.setProperty(
      '--row-fit',
      String(Math.min(1, Math.max(ROW_FIT_FLOOR, fitting / scale)))
    )
    onShortest(shortestLine)
  }
  // Smaller type also wraps less, so the height doesn't scale with the size: try sizes on the copy, halving the
  // gap each time. The gap between the rows is in em, so it is read at each size too
  const fits = (size: number) => {
    let tallest = tried.get(size)
    if (tallest === undefined) {
      lines.style.setProperty('--row-fit', String(size))
      const laid = tallestLineOf(lines)
      tallest = {
        gap: pixels(getComputedStyle(lines).rowGap),
        shortest: laid.shortest,
        tallest: laid.height,
      }
      tried.set(size, tallest)
    }
    const fit = tallest.tallest <= (height - tallest.gap) / 2 + 1
    // Which line is shortest barely moves between nearby sizes: the last size tried that fits and could be shown, or
    // any while none does. A size above the viewer's is only tried, never shown (I0wRx6C758o: the rows were sized for
    // a line that wraps tallest only at the largest size)
    if ((fit && size <= scale) || shortestLine < 0) {
      shortestLine = tallest.shortest
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
  // The room changed but the copy didn't: the bounds again from the sizes already tried, with no layout. A size below
  // a tried one wraps into no more rows, so its tallest line is at most the tried one's scaled down: every tried size
  // vouches for the sizes under it that fit at that scale. The largest size so vouched for is the fit (never too
  // large, so the rows never overflow); the halvings left refine it while nothing waits
  const rebound = () => {
    fitting = FIT_RANGE.min
    failing = Number.POSITIVE_INFINITY
    let at: number | null = null
    for (const [size, line] of tried) {
      if (line.tallest <= (height - line.gap) / 2 + 1) {
        if (size > fitting) {
          fitting = size
          at = size
        }
      } else {
        failing = Math.min(failing, size)
        const vouched =
          (size * (height / 2 + 1)) / (line.tallest + line.gap / 2)
        if (vouched > fitting) {
          fitting = vouched
          at = size
        }
      }
    }
    if (fitting >= FIT_RANGE.max) {
      fitting = Number.POSITIVE_INFINITY
      steps = 0
    } else if (failing === Number.POSITIVE_INFINITY) {
      steps = FIT_STEPS + 1
    } else {
      steps = Math.max(
        0,
        Math.ceil(Math.log2((failing - fitting) / FIT_PRECISION))
      )
    }
    if (at !== null) {
      // Which line is shortest: that of the size that vouched for the fit
      fits(at)
    }
  }
  // The docked translation's place follows the size; the song's copy doesn't. True when the room changed (the fit is
  // then known safe, and refined while nothing waits). Nothing before the first measure: there is no room yet to move,
  // and a fit judged on none would place the rows for a frame where they don't belong
  const resizeSlot = () => {
    if (measuredFor === '' || !area) {
      return false
    }
    const now = dockedSlotOf(reserve)
    if (now === slot) {
      return false
    }
    height += slot - now
    slot = now
    area.style.setProperty('--docked-h', `${slot}px`)
    clearTimeout(idle)
    rebound()
    return true
  }
  const measure = () => {
    if (
      !(
        block &&
        layer &&
        area &&
        lift instanceof HTMLElement &&
        spacer instanceof HTMLElement
      )
    ) {
      return
    }
    clearTimeout(idle)
    tried.clear()
    measuredFor = `${layer.clientWidth}x${layer.clientHeight}`
    const pad = getComputedStyle(block)
    slot = dockedSlotOf(reserve)
    height =
      layer.clientHeight -
      pixels(getComputedStyle(lift).minHeight) -
      pixels(getComputedStyle(spacer).minHeight) -
      pixels(pad.paddingTop) -
      pixels(pad.paddingBottom) -
      slot
    // The docked translation's place under the floor, the same whatever it says: a longer one never moves the rows
    area.style.setProperty('--docked-h', `${slot}px`)
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
      // A docked translation's place grows and shrinks with the size, and the room with it
      const roomMoved = reserve.childElementCount > 0 && resizeSlot()
      if (!roomMoved && next > fitting && steps > 0) {
        settle()
      }
      apply()
      // Once the slider rests (each step is arithmetic only): the song's tallest line at the size now shown, or the
      // rest of the search (a moved room puts it off until then)
      clearTimeout(resized)
      resized = setTimeout(() => {
        if (steps === 0) {
          fits(Math.max(ROW_FIT_FLOOR * scale, Math.min(scale, fitting)))
          apply()
        } else {
          clearTimeout(idle)
          refineLater()
        }
      }, FIT_IDLE_MS)
    },
    stop: () => {
      clearTimeout(idle)
      clearTimeout(resized)
      observer.disconnect()
      lineChanges.disconnect()
      document.fonts.removeEventListener('loadingdone', measure)
    },
  }
}

// One of Two Lines' lines, standing on its floor (the upper one --upper-floor over the rows' floor), so a line that
// wraps taller grows upward. Both share one grid cell, which is as tall as the taller of them stands
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
      'col-start-1 row-start-1 self-end transition-opacity duration-200',
      !sung && 'opacity-75',
      start
        ? 'lyric-stagger-start mb-[var(--upper-floor,0px)]'
        : 'lyric-stagger-end'
    )}>
    {children}
  </div>
)

// Two Lines, the two-way karaoke screen, built up from the floor so a line change moves as little as it can (owner,
// 2026-10-25): the lower line (at the right) stands on the rows' floor, which DraggableLyrics places (`floor`), so
// its romaji never moves. The upper line (at the left) stands a one-row pair and the rows' gap above it, and rises
// only by as much as the lower line's text reaches into its own (upperLineFloor); it stays risen until its own line
// changes. The block is only as tall as the lines drawn: a taller pair grows it upward, off the floor
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
  // Every translation of the song as it docks under the rows, while the translation shows, docked or not: the docked
  // place is sized for the tallest, and the rows' fit leaves room for it
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
  const [songShortest, setSongShortest] = useState(-1)
  useLayoutEffect(() => {
    const fit =
      gridRef.current && linesRef.current && reserveRef.current
        ? fitSong(
            gridRef.current,
            linesRef.current,
            reserveRef.current,
            setSongShortest
          )
        : null
    fitRef.current = fit
    return () => {
      fit?.stop()
      fitRef.current = null
    }
  }, [])
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
      // A one-row pair's height: how far over the floor the lines reach with the rows dragged to the top
      // (globals.css › lyrics-floor)
      const area = grid.closest<HTMLElement>('[data-lyric-rows-area]')
      const pair = `${2 * home.offsetHeight + gap}px`
      if (area && area.style.getPropertyValue('--rows-home') !== pair) {
        area.style.setProperty('--rows-home', pair)
      }
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

  // Before fitSong has measured, a line on screen stands in for the song's shortest
  const shortest = songShortest >= 0 ? songShortest : Math.max(...view.rows)
  return (
    <div
      ref={gridRef}
      className={cn(
        'relative lyric-rows-gap lyric-stagger-rows',
        STAGGER_SIZE.japanese
      )}>
      {/* The floor is this box's bottom: the lower line stands on it, the upper one --upper-floor above it */}
      <div
        ref={floorRef}
        data-lyric-floor
        className='relative grid grid-cols-1'>
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
// elsewhere on the stage (its place saved apart from the rows'), never into the rows' block (`dock.confine`). Let go
// over the block it docks under the rows instead (DockedTranslation); while docked the room stays, empty, for its
// place when it comes back. With no translation to show the block stays mounted, so a drag survives a gap.
// `placing`: put where it was let go off the rows, at once, not eased from its old place
const StaggerTranslation = ({
  children,
  layout,
  scale,
  colors,
  dock,
  targeted,
  placing,
}: {
  children: ReactNode
  layout: StageLayout
  scale: number
  colors: LyricsThemeColors
  dock: Dock
  targeted: boolean
  placing: boolean
}) => (
  <div data-lyric-translation className='lyric-stagger-translation-area'>
    <DraggableLyrics
      layout={layout}
      scale={scale}
      colors={colors}
      anchorAtom={lyricsTranslationAnchorAtom}
      dock={dock}
      targeted={targeted}
      eases={!placing}
      dragToEdge={false}>
      {children}
    </DraggableLyrics>
  </div>
)

// How far the docked translation must be pulled off the rows, up or down, to come away: a share of the stage's
// height, never less than a fingertip's travel. Short of it the translation springs back
const pullToTear = (stageHeight: number) => Math.max(40, 0.1 * stageHeight)
// How long after Karaoke Style is switched the rows keep their centre while their size settles
const SETTLE_HOLD_MS = 1000
const TAP_SLOP_PX = { mouse: 4, touch: 10 }

// The least gap kept between the translation placed on its own and the rows' block: like DraggableLyrics' EDGE, a
// share of the stage with a floor
const clearGap = (stageHeight: number) => Math.max(8, 0.02 * stageHeight)

// The rows' handle (their drawn block, the docked translation's place included), and the translation's in its room
const rowsHandleOf = (layer: HTMLElement) =>
  layer.querySelector<HTMLElement>(
    '[data-lyric-rows-area] [data-lyrics-style-toggle]'
  )
const translationHandleOf = (layer: HTMLElement) =>
  layer.querySelector<HTMLElement>(
    '[data-lyric-translation] [data-lyrics-style-toggle]'
  )

// The vertical move an element's `translate` and `transform` add (the upper row's --upper-floor, the pair's
// --pair-drop: Tailwind's translate-y-* sets `translate`): layout offsets leave both out
const shiftOf = (element: Element) => {
  const style = getComputedStyle(element)
  const [, y = '0'] =
    style.translate === 'none' ? [] : style.translate.split(' ')
  const moved = Number(y.replace(/px$/u, '')) || 0
  return style.transform === 'none'
    ? moved
    : moved + new DOMMatrixReadOnly(style.transform).m42
}

// An element's drawn top within the lyrics' layer, in layout units (a page turned by Lock Landscape keeps them): its
// offsets, plus every box's translate and transform from it up to the layer, offset parent or not
const drawnTopIn = (element: HTMLElement, layer: HTMLElement) => {
  let top = offsetIn(element, layer)
  for (let up: Element | null = element; up && up !== layer;) {
    top += shiftOf(up)
    up = up.parentElement
  }
  return top
}

// The rows' drawn lines within the lyrics' layer: their boxes, not their block, which also holds the docked place
const rowsTextOf = (layer: HTMLElement): Span | null => {
  const rows = [
    ...layer.querySelectorAll<HTMLElement>(
      '[data-lyric-rows-area] [data-lyric-row]'
    ),
  ].filter((row) => row.offsetHeight > 0)
  if (rows.length === 0) {
    return null
  }
  const tops = rows.map((row) => drawnTopIn(row, layer))
  return {
    bottom: Math.max(...rows.map((row, at) => tops[at] + row.offsetHeight)),
    top: Math.min(...tops),
  }
}

// The block the translation on its own keeps out of: the rows' drawn lines and, under them, the docked translation's
// place, which the block keeps whether the translation is there or not (UnderRows)
const blockAreaOf = (layer: HTMLElement): Span | null => {
  const lines = rowsTextOf(layer)
  const slot = layer.querySelector<HTMLElement>(
    '[data-lyric-rows-area] [data-docked-slot]'
  )
  if (lines === null) {
    return null
  }
  if (slot === null || slot.offsetHeight === 0) {
    return lines
  }
  const top = drawnTopIn(slot, layer)
  return {
    bottom: Math.max(lines.bottom, top + slot.offsetHeight),
    top: Math.min(lines.top, top),
  }
}

// Where the translation's handle may stand in its room, in layout units within the layer: from its anchor's top to
// its bottom, short of the room kept under it (its lift's least height)
const roomOf = (handle: HTMLElement, layer: HTMLElement) => {
  const track = handleTrack(handle, layer)
  if (track === null) {
    return null
  }
  const lift = handle.closest('.player-lyrics-overlay')?.nextElementSibling
  const under = lift ? pixels(getComputedStyle(lift).minHeight) : 0
  return {
    ...track,
    room: { bottom: track.base + track.free - under, top: track.base },
  }
}

interface Press {
  y: number
  slop: number
  tearAt: number
  moved: boolean
  // The text's top at rest and its height, in layout units within the lyrics' layer
  from: number
  height: number
  // What the pulled text keeps out of (the rows' lines, and the gap above them) and the room it moves in
  keepOut: Span | null
  room: Span
}

// Karaoke Style's translation docked under the rows, centred on them, in the place the rows' block keeps for it: part
// of their block, so it moves when they are dragged. Its own drag pulls it off them, up or down (the rows stay), never
// across their lines: pulled up, it stays under them until it fits whole above them. Let go past pullToTear it is
// placed on its own where it was let go (`onTear`: its text's centre there, within the lyrics' layer). `ghost`: the
// place it would dock, shown while the translation on its own is dragged onto the block
const DockedTranslation = ({
  children,
  layout,
  ghost = false,
  onTear,
}: {
  children: ReactNode
  layout: StageLayout
  ghost?: boolean
  onTear?: (centre: number) => void
}) => {
  // How far the pointer has moved it, down positive
  const [pull, setPull] = useState({ at: 0, px: 0 })
  const press = useRef<Press | null>(null)
  const setStylePanel = useSetAtom(lyricsStylePanelAtom)
  const torn = pull.at > 0 && Math.abs(pull.px) > pull.at
  const handleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Its own drag, not the rows'
    event.stopPropagation()
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const stage = element.closest('[data-player-stage]')
    const layer = element.closest<HTMLElement>('[data-lyric-layer]')
    const from = layer ? drawnTopIn(element, layer) : 0
    const lines = layer && rowsTextOf(layer)
    const height = layer?.clientHeight ?? 0
    press.current = {
      from,
      height: element.offsetHeight,
      // Its place under the lines counts as clear, however close the lines come to it
      keepOut: lines && {
        bottom: Math.min(lines.bottom, from),
        top: lines.top - clearGap(height),
      },
      moved: false,
      room: { bottom: height - element.offsetHeight, top: 0 },
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
    const asked = start.from + delta
    const at =
      start.keepOut === null
        ? asked
        : outsideOf(asked, start.height, start.keepOut, start.room, 0)
    if (at !== null) {
      setPull({ at: start.tearAt, px: at - start.from })
    }
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
      if (torn) {
        onTear?.(start.from + pull.px + start.height / 2)
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
      className='docked-translation relative flex h-full items-start justify-center'>
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
        data-press-ok={
          ghost ? undefined : 'drags the docked translation off from the press'
        }
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
  lineKey: number,
  // False for fitSong's unseen copy (LyricLine's `shown`)
  shown = true
): ReactNode =>
  line.translation &&
  line.text !== undefined &&
  !sameText(line.translation, line.text) ? (
    <LyricLine
      key={lineKey}
      html={line.translation}
      kind='translation'
      shown={shown}
      size={STAGGER_SIZE.translation}
      className='italic motion-safe:animate-in motion-safe:fade-in'
    />
  ) : undefined

// The translation on its own (`handle`), watched as it wraps taller or shorter, as it first shows, and as the rows'
// lines change: over the rows' block, it is set just outside it, on the nearer side with room (`place`: its new
// anchor), or, with room on neither side (a layout saved overlapped), docked (`dock`). The two never stay overlapped,
// so neither covers the other's grab. The rows never move for it
const keepOutOfBlock = (
  layer: HTMLElement,
  handle: HTMLElement,
  place: (anchor: number) => void,
  dock: () => void
) => {
  const observer = new ResizeObserver(() => {
    const block = blockAreaOf(layer)
    const track = roomOf(handle, layer)
    if (!(block && track) || handle.offsetHeight === 0) {
      return
    }
    const top = offsetIn(handle, layer)
    if (top >= block.bottom || top + handle.offsetHeight <= block.top) {
      return
    }
    const placed = outsideOf(
      top,
      handle.offsetHeight,
      block,
      track.room,
      clearGap(layer.clientHeight)
    )
    if (placed === null) {
      dock()
      return
    }
    place(clamp01((placed - track.base) / track.free))
  })
  observer.observe(handle)
  for (const watched of layer.querySelectorAll(
    '[data-lyric-rows-area] [data-lyrics-style-toggle], [data-lyric-rows-area] [data-lyric-row]'
  )) {
    observer.observe(watched)
  }
  return () => {
    observer.disconnect()
  }
}

// Calls `read` when any of `boxes` resizes; returns the cleanup
const watchResize = (boxes: Element[], read: () => void) => {
  const observer = new ResizeObserver(read)
  for (const box of boxes) {
    observer.observe(box)
  }
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
// over the rows' block right now (where letting go docks it), and placing it on its own again. The rows' block is the
// same docked or not: it keeps the docked translation's place under the rows either way, in a room that doesn't
// change, so docking and undocking (a drag, the switch, another device) never move the rows; the translation goes to
// them, or leaves them. Only Karaoke Style switched, or the translation shown or hidden, changes the rows' room: then
// the rows keep where they were
const useTranslationDock = (
  layerRef: RefObject<HTMLDivElement | null>,
  translated: boolean,
  twoLines: boolean,
  // The sung line, -1 between lines (no rows drawn)
  active: number
) => {
  const room: RowsRoom = translated ? 'translated' : 'none'
  const rowsShown = twoLines && active >= 0
  const [docked, setDocked] = useAtom(translationDockedAtom)
  const setAnchor = useSetAtom(lyricsTranslationAnchorAtom)
  const setDragged = useSetAtom(lyricsPositionsDraggedAtom)
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
  // Pulled off, the centre of its text where it was let go: placed there once it is back in its room, before paint,
  // as its room wraps it differently from the rows' width
  const drop = useRef<number | null>(null)
  // While it is being placed there: no ease from its old place
  const [placing, setPlacing] = useState(false)
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
        const anchor = anchorForTop(
          rows,
          layer,
          hold.centre - rows.offsetHeight / 2
        )
        if (anchor !== null) {
          setRowsAnchor(anchor)
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
    const at = rowsAt.current
    if (
      (before.room === room && before.twoLines === twoLines) ||
      !(layer && rows) ||
      at === null
    ) {
      return
    }
    // Switching Karaoke Style on or off swaps one line's block for two rows of another height: the block keeps its
    // centre, so the sung line stays about where it was. Showing or hiding the translation keeps the rows' top
    const switched = before.twoLines !== twoLines
    const target = switched
      ? at.top + at.height / 2 - rows.offsetHeight / 2
      : at.top
    const anchor = anchorForTop(rows, layer, target)
    if (anchor === null) {
      return
    }
    setRowsAnchor(anchor)
    // Two rows settle their size a frame or more after the switch (fitSong): while they do, the block keeps the
    // centre it had, instead of growing about its anchor
    if (switched) {
      holdCentre.current = {
        centre: at.top + at.height / 2,
        until: performance.now() + SETTLE_HOLD_MS,
      }
    }
  }, [room, twoLines, layerRef, setRowsAnchor])
  // Docked, the translation's place opens under the floor. Where there's no room for it there (the rows at the foot),
  // the rows' anchor goes up by just enough, so they rise as it opens (globals.css › lyric-stagger-area[data-docked])
  // and stay where they are when it is taken off again. Again after a drop or a reset while docked, and when the place
  // or the stage resizes (the size, the first fit)
  const roomUnderFloor = useRef(() => {
    // Set below, after each render
  })
  useLayoutEffect(() => {
    roomUnderFloor.current = () => {
      if (!(docked && rowsShown && room !== 'none')) {
        return
      }
      const layer = layerRef.current
      const rows = layer && rowsHandleOf(layer)
      const area = rows?.closest<HTMLElement>('[data-lyric-rows-area]')
      const track = rows && floorTrackOf(rows)
      if (!(area && track)) {
        return
      }
      const place = pixels(
        getComputedStyle(area).getPropertyValue('--docked-h')
      )
      const highest = clamp01(1 - place / track.free)
      if (rowsAnchor > highest + 0.001) {
        setRowsAnchor(highest)
      }
    }
    roomUnderFloor.current()
  })
  useEffect(() => {
    const layer = layerRef.current
    // The place mounts with the rows
    const slot =
      docked && rowsShown ? layer?.querySelector('[data-docked-slot]') : null
    return layer && slot
      ? watchResize([layer, slot], () => {
          roomUnderFloor.current()
        })
      : undefined
  }, [layerRef, docked, rowsShown])
  // Pulled off the rows: the translation, back in its room, stands where it was let go, outside the block (or, with
  // no room for it outside, docks again)
  useLayoutEffect(() => {
    const centre = drop.current
    drop.current = null
    const layer = layerRef.current
    const handle = layer && translationHandleOf(layer)
    const track =
      layer !== null && handle !== null ? roomOf(handle, layer) : null
    if (docked || centre === null || !(layer && handle && track)) {
      return
    }
    const block = blockAreaOf(layer)
    const asked = centre - handle.offsetHeight / 2
    const top =
      block === null
        ? asked
        : outsideOf(
            asked,
            handle.offsetHeight,
            block,
            track.room,
            clearGap(layer.clientHeight)
          )
    if (top === null) {
      setDocked(true)
      return
    }
    setAnchor(clamp01((top - track.base) / track.free))
  }, [docked, layerRef, setAnchor, setDocked])
  useEffect(() => {
    const frame = placing
      ? requestAnimationFrame(() => {
          setPlacing(false)
        })
      : 0
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [placing])
  // Holding the rows' centre while they settle after Karaoke Style is switched (above). The rows' handle is one
  // element for good (DraggableLyrics stays mounted across the switch)
  useLayoutEffect(() => {
    const layer = layerRef.current
    const rows = layer && rowsHandleOf(layer)
    return layer && rows ? holdWhileSettling(layer, rows) : undefined
  }, [layerRef, holdWhileSettling])
  // Where the rows are drawn, kept for the room effect above (it needs where they were before the room or the layout
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
  // The translation on its own is never left over the rows' block (keepOutOfBlock); again when it docks or undocks,
  // or the rows' lines mount
  useEffect(() => {
    const layer = layerRef.current
    const handle = layer && translationHandleOf(layer)
    return layer && handle && room !== 'none' && !docked && rowsShown
      ? keepOutOfBlock(
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
  }, [room, docked, rowsShown, layerRef, setAnchor, setDocked])
  // The docked translation pulled off by the listener: a move of theirs, as a drag's drop is
  const handleTear = (centre: number) => {
    drop.current = centre
    setPlacing(true)
    setDocked(false)
    setDragged(true)
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
  // Where the pointer asks the translation's handle to stand, with its room and the block, in layout units
  const asking = (asked: number, handle: HTMLElement) => {
    const layer = layerRef.current
    const track = layer && roomOf(handle, layer)
    const block = layer && blockAreaOf(layer)
    return layer && track && block
      ? { block, layer, top: track.base + asked * track.free, track }
      : null
  }
  // The translation dragged on its own: it stands only outside the rows' block, just past it on the nearer side with
  // room when the pointer asks for a place inside it, and stays put where it has none; the place asked for over the
  // block (its centre inside) is where letting go docks it
  const pull: Dock = {
    confine: (asked, handle) => {
      const at = asking(asked, handle)
      if (at === null) {
        return asked
      }
      const top = outsideOf(
        at.top,
        handle.offsetHeight,
        at.block,
        at.track.room,
        clearGap(at.layer.clientHeight)
      )
      return top === null
        ? null
        : clamp01((top - at.track.base) / at.track.free)
    },
    onDrop: (over) => {
      if (over) {
        setDocked(true)
      }
    },
    onOver: setOffered,
    over: (asked, handle) => {
      const at = asking(asked, handle)
      return at !== null && overBlock(at.top, handle.offsetHeight, at.block)
    },
  }
  // The rows dragged onto the translation on its own dock it as surely as the other way round: any overlap with the
  // block, since the rows are the larger block and couldn't be set clear of it the way the translation is
  const rowsPull: Dock = {
    onDrop: (over) => {
      if (over) {
        setDocked(true)
      }
    },
    onOver: setRowsOffered,
    over: () => {
      const layer = layerRef.current
      const block = layer && blockAreaOf(layer)
      const own = translationBox()
      return (
        block !== null &&
        own !== null &&
        own.bottom > block.top &&
        own.top < block.bottom
      )
    },
  }
  return {
    docked,
    handleTear,
    offered,
    placing,
    pull,
    rowsOffered,
    rowsPull,
  }
}

// Under the rows' floor, the docked translation's place: open while docked, with the docked translation in it, and
// shut otherwise (globals.css › docked-slot), so the block ends at the floor. While the translation on its own is
// dragged onto the block, a faint copy of it shows where it would dock, taking no room
const UnderRows = ({
  dock,
  layout,
  children,
}: {
  dock: ReturnType<typeof useTranslationDock>
  layout: StageLayout
  children: ReactNode
}) => {
  let inside: ReactNode = null
  if (children !== undefined && dock.docked) {
    inside = (
      <DockedTranslation layout={layout} onTear={dock.handleTear}>
        {children}
      </DockedTranslation>
    )
  } else if (children !== undefined && dock.offered) {
    inside = (
      <DockedTranslation layout={layout} ghost>
        {children}
      </DockedTranslation>
    )
  }
  return (
    <div data-docked-slot className='relative docked-slot'>
      {inside}
    </div>
  )
}

// Which room Two Lines' rows move in (globals.css › lyric-stagger-area): with the translation shown, the whole stage
// (`translated`), the same whether the translation is docked under them or on its own; without it, the stage's lower
// part (`none`)
type RowsRoom = 'none' | 'translated'
const rowsAreaOf = (translated: boolean, docked: boolean) => ({
  'data-docked': (translated && docked) || undefined,
  'data-translated': translated || undefined,
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
        const rate = engineRate()
        // YouTube reports time in steps; the clock smooths it for the fill, at the speed the video plays
        clockRef.current = advancePlaybackClock(clockRef.current, {
          mediaTime: reported,
          now: performance.now(),
          playing: playingRef.current,
          rate,
        })
        const time = clockRef.current.time + lyricsLead(rate)
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
          const time = reported + lyricsLead(engineRate())
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
  const songTranslations = useMemo(
    () =>
      Array.from(
        { length: twoLines && showTranslation ? lineCount : 0 },
        (_, index) => {
          const translation = translationOf(
            lineAt(lyrics, karaokeLines, index, english, undefined),
            index,
            false
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
    [twoLines, showTranslation, lineCount, lyrics, karaokeLines, english]
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
  const dock = useTranslationDock(layerRef, translated, twoLines, view.active)
  const underRows = translated && (
    <UnderRows dock={dock} layout={layout}>
      {translationLine}
    </UnderRows>
  )
  return (
    <div
      ref={layerRef}
      data-lyric-layer
      className='absolute inset-0 isolate lyric-stagger-layer'
      style={layerVars}>
      {translated && (
        <StaggerTranslation
          layout={layout}
          scale={scale}
          colors={colors}
          dock={dock.pull}
          targeted={dock.rowsOffered}
          placing={dock.placing}>
          {dock.docked ? undefined : translationLine}
        </StaggerTranslation>
      )}
      {/* Always this box, so the lyrics stay mounted when two lines turn on or off; two lines move over the whole
          stage with their translation shown, in its lower part without it */}
      <div
        data-lyric-rows-area
        {...rowsAreaOf(translated, dock.docked)}
        className={cn(
          'absolute inset-x-0 bottom-0',
          twoLines ? 'lyric-stagger-area' : 'top-0'
        )}>
        <DraggableLyrics
          layout={layout}
          scale={scale}
          colors={colors}
          wide={twoLines}
          floor={twoLines}
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
