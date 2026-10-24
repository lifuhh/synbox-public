import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type { ReactNode } from 'react'
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
  translationDockedAtom,
  lyricsStylePanelAtom,
} from '@/context/atoms'
import { useLyricsSurface } from '@/hooks/use-media-query'
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

import { DraggableLyrics, swallowNextClick } from './draggable-lyrics'
import type { StageLayout } from './player-stage'
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

// The song's tallest line, as laid out now
const tallestOf = (lines: HTMLElement) => {
  let tallest = 0
  for (const line of lines.children) {
    if (line instanceof HTMLElement) {
      tallest = Math.max(tallest, line.offsetHeight)
    }
  }
  return tallest
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
  reserve: HTMLElement
) => {
  const block = grid.closest<HTMLElement>('.player-lyrics-overlay')
  const layer = block?.parentElement
  const lift = block?.nextElementSibling
  let scale = 1
  // The largest size known to fit and the smallest known not to; `steps` halvings of the gap remain
  let fitting = Number.POSITIVE_INFINITY
  let failing = Number.POSITIVE_INFINITY
  let steps = 0
  let height = 0
  let measuredFor = ''
  let idle: ReturnType<typeof setTimeout> | undefined
  const apply = () => {
    grid.style.setProperty(
      '--row-fit',
      String(Math.min(1, Math.max(ROW_FIT_FLOOR, fitting / scale)))
    )
  }
  // Smaller type also wraps less, so the height doesn't scale with the size: try sizes on the copy, halving the
  // gap each time. The gap between the rows is in em, so it is read at each size too
  const fits = (size: number) => {
    lines.style.setProperty('--row-fit', String(size))
    return (
      tallestOf(lines) <=
      (height - pixels(getComputedStyle(lines).rowGap)) / 2 + 1
    )
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
    if (!(block && layer && lift instanceof HTMLElement)) {
      return
    }
    clearTimeout(idle)
    measuredFor = `${layer.clientWidth}x${layer.clientHeight}`
    const pad = getComputedStyle(block)
    height =
      layer.clientHeight -
      pixels(getComputedStyle(lift).minHeight) -
      pixels(pad.paddingTop) -
      pixels(pad.paddingBottom) -
      tallestOf(reserve)
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

const TwoLineRow = ({
  sung,
  start,
  children,
}: {
  sung: boolean
  start: boolean
  children: ReactNode
}) => (
  <div
    data-lyric-row={sung ? 'sung' : 'next'}
    className={cn(
      'transition-opacity duration-200',
      !sung && 'opacity-75',
      start ? 'lyric-stagger-start' : 'lyric-stagger-end'
    )}>
    {children}
  </div>
)

// Two Lines, the two-way karaoke screen: equal rows, so a longer line in one row never moves the other, set
// apart so each line's own rows read as its own; the top row's line at the left and the bottom row's at the
// right, the waiting line dimmed
const TwoRows = ({
  view,
  rowsOf,
  songLines,
  songTranslations,
  scale,
}: {
  view: TwoLineView
  rowsOf: (index: number) => ReactNode
  // Every line of the song, each at a row's width, for fitSong
  songLines: ReactNode
  // Every translation of the song as it docks under the rows, while it does; the rows leave room for the tallest
  songTranslations: ReactNode
  scale: number
}) => {
  const gridRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const reserveRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<ReturnType<typeof fitSong> | null>(null)
  useLayoutEffect(() => {
    const fit =
      gridRef.current && linesRef.current && reserveRef.current
        ? fitSong(gridRef.current, linesRef.current, reserveRef.current)
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
  return (
    <div
      ref={gridRef}
      className={cn(
        'relative grid auto-rows-fr lyric-rows-gap lyric-stagger-rows',
        STAGGER_SIZE.japanese
      )}>
      {view.rows.map((index, row) => (
        <TwoLineRow
          // The rows are fixed places; only the lines in them change
          // oxlint-disable-next-line no-array-index-key
          key={row}
          sung={index === view.active}
          start={row === 0}>
          {index >= 0 && rowsOf(index)}
        </TwoLineRow>
      ))}
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

// Two Lines' one translation, for the line being sung, centred in its own room at the top of the video, where
// the viewer can drag it (its place saved apart from the rows'). Pulled down past the room's floor it docks under the
// rows instead (DockedTranslation); while docked the room stays, empty, for its place when it comes back. With no
// translation to show the block stays mounted, so a drag survives a gap
const StaggerTranslation = ({
  children,
  layout,
  scale,
  colors,
  dock,
}: {
  children: ReactNode
  layout: StageLayout
  scale: number
  colors: LyricsThemeColors
  dock: { onPull: (over: boolean) => void; onDock: () => void }
}) => (
  <div data-lyric-translation className='lyric-stagger-translation-area'>
    <DraggableLyrics
      layout={layout}
      scale={scale}
      colors={colors}
      anchorAtom={lyricsTranslationAnchorAtom}
      lifts={false}
      dock={dock}>
      {children}
    </DraggableLyrics>
  </div>
)

// How far the docked translation must be pulled up off the rows to come away: a share of the stage's height, never
// less than a fingertip's travel. Short of it the translation springs back
const pullToTear = (stageHeight: number) => Math.max(40, 0.1 * stageHeight)
const TAP_SLOP_PX = { mouse: 4, touch: 10 }

// An element's top within an ancestor, in layout: the page's own axes, which a page turned by Lock Landscape keeps
const offsetIn = (element: HTMLElement, ancestor: HTMLElement) => {
  let top = 0
  let at: Element | null = element
  while (at instanceof HTMLElement && at !== ancestor) {
    top += at.offsetTop
    at = at.offsetParent
  }
  return top
}

interface Press {
  y: number
  slop: number
  tearAt: number
  moved: boolean
}

// Karaoke Style's translation docked under the rows, centred on them: part of their block, so it moves when they are
// dragged. Its own drag pulls it upward off them (the rows stay); let go past pullToTear it goes back to its room at
// the top, where it was let go (`onTear`: its top there, within the lyrics' layer). `ghost`: the place it would dock,
// shown while it is pulled down to the rows
const DockedTranslation = ({
  children,
  layout,
  ghost = false,
  onTear,
}: {
  children: ReactNode
  layout: StageLayout
  ghost?: boolean
  onTear?: (top: number, layer: HTMLElement) => void
}) => {
  const [pull, setPull] = useState({ at: 0, px: 0 })
  const press = useRef<Press | null>(null)
  const setStylePanel = useSetAtom(lyricsStylePanelAtom)
  const torn = pull.at > 0 && pull.px > pull.at
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
    setPull({ at: start.tearAt, px: Math.max(0, -delta) })
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
        onTear?.(offsetIn(element, layer) - pull.px, layer)
      }
      setPull({ at: 0, px: 0 })
    } else if (event.pointerType === 'mouse') {
      setStylePanel('pinned')
    } else {
      layout.tapStage()
    }
  }
  const vars: CssVars = { '--dock-pull': `${-pull.px}px` }
  return (
    <div
      data-docked-translation={ghost ? 'ghost' : 'docked'}
      className='flex justify-center docked-translation'>
      <div
        style={vars}
        className={cn(
          'max-w-[85%] translate-y-(--dock-pull) rounded-xl px-cqw text-center',
          ghost
            ? 'pointer-events-none'
            : 'lyrics-hit-text cursor-grab touch-none transition-fade-translate duration-200 ease-out motion-reduce:transition-none',
          pull.px > 0 && 'cursor-grabbing transition-none',
          torn && 'opacity-60'
        )}
        onPointerDown={ghost ? undefined : handleDown}
        onPointerMove={ghost ? undefined : handleMove}
        onPointerUp={ghost ? undefined : handleUp}
        onPointerCancel={ghost ? undefined : handleUp}>
        {children}
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

// Whether Karaoke Style's translation is docked under the rows (one choice for every song), whether a pull down offers
// to dock it right now, and pulling it off again: back to its room at the top, where it was let go
const useTranslationDock = () => {
  const [docked, setDocked] = useAtom(translationDockedAtom)
  const setAnchor = useSetAtom(lyricsTranslationAnchorAtom)
  const [offered, setOffered] = useState(false)
  // Pulled off, it lands in its room with its top where it was let go: placed once it is back there, before
  // paint, as its room wraps it differently from the rows' width. In layout units, which a page turned by Lock
  // Landscape keeps
  const drop = useRef<{ top: number; layer: HTMLElement } | null>(null)
  const handleTear = (top: number, layer: HTMLElement) => {
    drop.current = { layer, top }
    setDocked(false)
  }
  useLayoutEffect(() => {
    const dropped = drop.current
    if (docked || dropped === null) {
      return
    }
    drop.current = null
    const room = dropped.layer.querySelector<HTMLElement>(
      '[data-lyric-translation]'
    )
    const block = room?.querySelector<HTMLElement>('.player-lyrics-overlay')
    const handle = block?.querySelector<HTMLElement>(
      '[data-lyrics-style-toggle]'
    )
    const area = block?.parentElement
    if (room && block && handle && area) {
      // As DraggableLyrics reads its anchor: the block's top over the room it can move in
      const free = Math.max(1, area.clientHeight - block.offsetHeight)
      const top = dropped.top - room.offsetTop - handle.offsetTop
      setAnchor(Math.min(1, Math.max(0, top / free)))
    }
  }, [docked, setAnchor])
  const pull = {
    onDock: () => {
      setDocked(true)
    },
    onPull: setOffered,
  }
  return { docked, handleTear, offered, pull }
}

// Under the rows: the docked translation, or while it is pulled down to dock, its place there
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
  const songLines = useMemo(
    () =>
      Array.from({ length: twoLines ? lineCount : 0 }, (_, index) => {
        const line = lineAt(lyrics, karaokeLines, index, english, undefined)
        return (
          // Lines are positional and never reorder
          // oxlint-disable-next-line no-array-index-key
          <div key={index} className='lyric-stagger-start'>
            {line.text !== undefined && (
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
            )}
          </div>
        )
      }),
    [twoLines, lineCount, lyrics, karaokeLines, english, showLyrics, showRomaji]
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
                className='flex justify-center docked-translation'>
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
  const layerVars: CssVars = {
    '--lyric-glow': colors.glow,
    '--lyric-scale': scale,
  }
  // Karaoke Style's translation: in its room at the top, or docked under the rows
  const translated = twoLines && showTranslation
  const translationLine = translationOf(
    lineAt(lyrics, karaokeLines, view.active, english, placeholder),
    view.active
  )
  const dock = useTranslationDock()
  const underRows = translated && (
    <UnderRows dock={dock} layout={layout}>
      {translationLine}
    </UnderRows>
  )
  return (
    <div
      data-lyric-layer
      className='absolute inset-0 lyric-stagger-layer'
      style={layerVars}>
      {translated && (
        <StaggerTranslation
          layout={layout}
          scale={scale}
          colors={colors}
          dock={dock.pull}>
          {dock.docked ? undefined : translationLine}
        </StaggerTranslation>
      )}
      {/* Always this box, so the lyrics stay mounted when two lines turn on or off; two lines move only in
          the stage's lower part, under their translation */}
      <div
        data-translation={(translated && !dock.docked) || undefined}
        className={cn(
          'absolute inset-x-0 bottom-0',
          twoLines ? 'lyric-stagger-area' : 'top-0'
        )}>
        <DraggableLyrics
          layout={layout}
          scale={scale}
          colors={colors}
          wide={twoLines}>
          {twoLines && view.active >= 0 ? (
            <>
              <TwoRows
                view={view}
                rowsOf={rowsOf}
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
