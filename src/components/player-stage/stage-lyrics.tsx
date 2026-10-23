import { useAtomValue } from 'jotai'
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
import { lyricsScaleOn } from '@/lib/lyrics-style'
import { getLyricsThemeColors } from '@/lib/lyrics-themes'
import type { LyricsThemeColors } from '@/lib/lyrics-themes'
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

import { DraggableLyrics } from './draggable-lyrics'
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
  // False for a copy laid out only to be measured: the bench's first-lyric hook is for drawn lines
  shown?: boolean
}) => {
  const segments = useMemo(() => parseRubyHtml(html), [html])
  const latin = kind !== 'japanese' || isLatinOnly(html)
  return (
    <p
      key={html}
      data-bench={shown ? 'lyrics-line' : undefined}
      data-row={row}
      ref={balanceWrap}
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
            <KaraokeLine key={lineKey} ref={track} line={karaokeLine} />
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

// Halvings of the gap between the floor and full size: within 1% of the largest size that fits
const FIT_STEPS = 6

// One size for both rows, for the whole song: each row gets half the room under the translation, and when the
// song's tallest line (`lines`, every line laid out unseen at a row's width) wraps taller than that,
// both rows shrink by as much. So the two lines on screen are always the same size, the rows never climb over the
// translation, and no row changes size while its line is sung. The room is the layer's, less the room kept
// under the block
const fitSong = (grid: HTMLElement, lines: HTMLElement) => {
  const block = grid.closest<HTMLElement>('.player-lyrics-overlay')
  const layer = block?.parentElement
  const lift = block?.nextElementSibling
  const fit = () => {
    if (!(block && layer && lift instanceof HTMLElement)) {
      return
    }
    const pad = getComputedStyle(block)
    const room =
      (layer.clientHeight -
        pixels(getComputedStyle(lift).minHeight) -
        pixels(pad.paddingTop) -
        pixels(pad.paddingBottom) -
        pixels(getComputedStyle(grid).rowGap)) /
      2
    // The largest size at which the tallest line fits. Smaller type also wraps less, so the height doesn't
    // scale with the size: try sizes on the unseen copy, halving the gap each time
    const fits = (scale: number) => {
      lines.style.setProperty('--row-fit', String(scale))
      return tallestOf(lines) <= room + 1
    }
    let scale = 1
    if (!fits(1)) {
      let [low, high] = [ROW_FIT_FLOOR, 1]
      for (let step = 0; step < FIT_STEPS; step += 1) {
        const mid = (low + high) / 2
        if (fits(mid)) {
          low = mid
        } else {
          high = mid
        }
      }
      scale = low
    }
    lines.style.setProperty('--row-fit', '1')
    grid.style.setProperty('--row-fit', String(scale))
  }
  // Wrapping settles after the type changes (balanceWrap), and the room moves with the stage
  const observer = new ResizeObserver(fit)
  observer.observe(lines)
  if (layer) {
    observer.observe(layer)
  }
  return () => {
    observer.disconnect()
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
}: {
  view: TwoLineView
  rowsOf: (index: number) => ReactNode
  // Every line of the song, each at a row's width, for fitSong
  songLines: ReactNode
}) => {
  const gridRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(
    () =>
      gridRef.current && linesRef.current
        ? fitSong(gridRef.current, linesRef.current)
        : undefined,
    []
  )
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
      {/* Laid out at the rows' width, never seen and taking no room; fitSong tries its sizes on it */}
      <div
        aria-hidden
        className='pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden lyric-stagger-rows [--row-fit:1]'>
        <div ref={linesRef}>{songLines}</div>
      </div>
    </div>
  )
}

// Two Lines' one translation, for the line being sung, centred in its own room at the top of the video, where
// the viewer can drag it (its place saved apart from the rows'). It changes with the line, fading in where motion
// is welcome; with no translation to show the block stays mounted, so a drag survives a gap
const StaggerTranslation = ({
  line: { text, translation },
  lineKey,
  layout,
  scale,
  colors,
}: {
  line: ReturnType<typeof lineAt>
  lineKey: number
  layout: StageLayout
  scale: number
  colors: LyricsThemeColors
}) => (
  <div data-lyric-translation className='lyric-stagger-translation-area'>
    <DraggableLyrics
      layout={layout}
      scale={scale}
      colors={colors}
      anchorAtom={lyricsTranslationAnchorAtom}
      lifts={false}>
      {translation && text !== undefined && !sameText(translation, text) ? (
        <LyricLine
          key={lineKey}
          html={translation}
          kind='translation'
          size={STAGGER_SIZE.translation}
          className='italic motion-safe:animate-in motion-safe:fade-in'
        />
      ) : undefined}
    </DraggableLyrics>
  </div>
)

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
  const layerVars: CssVars = {
    '--lyric-glow': colors.glow,
    '--lyric-scale': scale,
  }
  return (
    <div className='absolute inset-0 lyric-stagger-layer' style={layerVars}>
      {twoLines && showTranslation && (
        <StaggerTranslation
          line={lineAt(lyrics, karaokeLines, view.active, english, placeholder)}
          lineKey={view.active}
          layout={layout}
          scale={scale}
          colors={colors}
        />
      )}
      {/* Always this box, so the lyrics stay mounted when two lines turn on or off; two lines move only in
          the stage's lower part, under their translation */}
      <div
        data-translation={(twoLines && showTranslation) || undefined}
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
            <TwoRows view={view} rowsOf={rowsOf} songLines={songLines} />
          ) : (
            rowsOf(view.active)
          )}
        </DraggableLyrics>
      </div>
    </div>
  )
}
