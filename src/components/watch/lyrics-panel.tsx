import { useAtomValue, useSetAtom } from 'jotai'
import {
  LocateFixedIcon,
  Maximize2Icon,
  Minimize2Icon,
  PaletteIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { KaraokeLineHandle } from '@/components/lyrics-display/karaoke-line'
import type { LineShow } from '@/components/offline/lyric-line-block'
import {
  linePhase,
  LyricLineBlock,
} from '@/components/offline/lyric-line-block'
import { useLyricsFollow } from '@/components/offline/use-lyrics-follow'
import { lineReached } from '@/components/offline/use-silent-playback'
import {
  lyricsLead,
  parseLyricsText,
} from '@/components/player-stage/stage-lyrics'
import { engineRate } from '@/components/player-stage/youtube-engine'
import { Button } from '@/components/ui/button'
import {
  chartSongAtom,
  currentVideoAtom,
  lyricsCustomHueAtom,
  lyricsStylePanelAtom,
  lyricsThemeIdAtom,
  lyricsVisibilityAtom,
  romajiVisibilityAtom,
  stageClockAtom,
  translationIsEnglishAtom,
  translationVisibilityAtom,
} from '@/context/atoms'
import { currentLineIndex, karaokeMatchesLyrics } from '@/lib/karaoke'
import { RateLimitedError } from '@/lib/lyrics-api'
import { parseLyricsDocument } from '@/lib/lyrics-document'
import { getLyricsThemeColors } from '@/lib/lyrics-themes'
import type { OfflineLine } from '@/lib/offline/song'
import { offlineLines } from '@/lib/offline/song'
import {
  useGetKaraokeById,
  useGetLyricsBySongId,
  useGetLyricsVersion,
} from '@/lib/react-query/queries-and-mutations'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import { GenerateLyricsButton } from './generate-lyrics-button'

// A clock that jumps further than this between frames was seeked (from the video, the bar or a key)
const SEEK_JUMP_SEC = 1.5
// A clock that hasn't moved for this long is paused
const PAUSED_AFTER_MS = 500
// A press held longer than this is the start of a look around the song, not a tap
const TAP_MAX_MS = 500
const NO_LINES: OfflineLine[] = []

// The song's lines as the reader draws them, with karaoke timing where it was made for exactly these lines
const useSongLines = (videoId: string, version: number | null) => {
  const {
    data: activeLyrics,
    error,
    isPending,
  } = useGetLyricsBySongId(version === null ? videoId : '')
  const { data: versionLyrics } = useGetLyricsVersion(videoId, version)
  const data = version === null ? activeLyrics : versionLyrics
  const { data: karaokeDoc } = useGetKaraokeById(videoId, version)
  const lines = useMemo(() => {
    const lyrics = parseLyricsDocument(data)
    if (lyrics === null) {
      return NO_LINES
    }
    const plain = parseLyricsText(data).plain_lyrics
    const karaoke =
      karaokeDoc && karaokeMatchesLyrics(karaokeDoc.lines, plain)
        ? karaokeDoc.lines
        : null
    return offlineLines(lyrics, karaoke)
  }, [data, karaokeDoc])
  return {
    limited: error instanceof RateLimitedError,
    lines,
    loading: version === null && isPending,
  }
}

// A tap on the band toggles its size: small, it expands, as Spotify's and Apple Music's lyrics cards do; expanded, it
// goes back to small (the band's lines don't seek, so a tap has nothing else to do). A press held longer is not a
// tap, nor is a swipe through the lines. Only over lines (`on`): with none there is nothing to resize, and a press on
// a disabled Generate Lyrics (which takes no pointer events) would fall through to it
const useExpandTap = (on: boolean, toggle: () => void) => {
  const pressedAt = useRef(0)
  if (!on) {
    return {}
  }
  return {
    onClick: () => {
      if (performance.now() - pressedAt.current < TAP_MAX_MS) {
        toggle()
      }
    },
    onPointerDown: () => {
      pressedAt.current = performance.now()
    },
  }
}

// The line before the sung one fades out at the top edge instead of being cut through; the fade's height is
// padding too, so the first line (its furigana included) starts below it. Under the last line, only room to
// clear Current Line (12px off the foot, 36px tall) and a gap. Scrolling on past either end moves the page, so
// the wheel never goes dead over the panel. The band fades at both edges (watch-lyrics-band-scroller)
const scrollerLook = (band: boolean, empty: boolean) => {
  if (!band) {
    return 'overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,#000_1.25rem)] pt-5 pb-16'
  }
  if (empty) {
    return 'grid place-items-center'
  }
  return 'watch-lyrics-band-scroller overflow-y-auto'
}

// The band's own corner: Expand while small; Lyrics Style and Minimize while expanded, when the rail's
// Lyrics Style is out of sight under it
const BandCorner = ({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}) => {
  const setStylePanel = useSetAtom(lyricsStylePanelAtom)
  return (
    <div className='absolute top-1.5 right-1.5 z-10 flex gap-1'>
      {expanded && (
        <Button
          variant='surface-icon'
          size='icon'
          aria-label='Lyrics Style'
          onClick={() => {
            setStylePanel('pinned')
          }}>
          <PaletteIcon className='size-5' />
        </Button>
      )}
      <Button
        variant='surface-icon'
        size='icon'
        aria-label={expanded ? 'Minimize Lyrics' : 'Expand Lyrics'}
        aria-expanded={expanded}
        onClick={() => {
          onExpandedChange(!expanded)
        }}>
        {expanded ? (
          <Minimize2Icon className='size-5' />
        ) : (
          <Maximize2Icon className='size-5' />
        )}
      </Button>
    </div>
  )
}

// The whole song beside or under the video: the line being sung lights up and fills as it is sung, the panel
// follows it until the viewer scrolls, and a tap on a line plays from there. The same toggles as the
// player's rail choose the rows.
// As a band (under the video on a phone held upright) it is a karaoke window instead: the sung line centred at
// the Lyrics Style size, the lines either side fading out at its edges, and a tap expands it to fill the screen
// under the video, never a seek. Expanded, holding and scrolling reads elsewhere until Current Line or a seek,
// while the song plays on
// What the panel says instead of lines: '' while they load, null when it has lines to show
const emptyText = ({
  anyShown,
  hasLines,
  limited,
  loading,
}: {
  anyShown: boolean
  hasLines: boolean
  limited: boolean
  loading: boolean
}) => {
  if (hasLines) {
    return anyShown
      ? null
      : 'Lyrics, Romaji and Translation are all turned off.'
  }
  if (loading) {
    return ''
  }
  return limited
    ? 'Too many songs this hour. Try again soon.'
    : 'No lyrics for this song yet.'
}

// Why the panel has no lines. A chart song (Top 100 Japan, not in Synbox yet) offers its lyrics where they
// would be
const EmptyLyrics = ({
  videoId,
  text,
  limited,
}: {
  videoId: string
  text: string
  limited: boolean
}) => {
  const chart = useAtomValue(chartSongAtom)?.videoId === videoId
  const title = useAtomValue(currentVideoAtom)?.title
  // Refused for opening too many songs this hour: the song may well have lyrics, so no Generate Lyrics
  if (!chart || limited) {
    return <p className='py-6 text-sm text-muted-foreground'>{text}</p>
  }
  // Nothing while the lyrics are still being asked for
  return text === '' ? null : (
    <div className='flex flex-col items-center gap-3 py-16 text-center'>
      <p className='text-sm text-muted-foreground'>No Lyrics Yet</p>
      <GenerateLyricsButton videoId={videoId} title={title} />
    </div>
  )
}

// The band's size: small in the page, or expanded to fill the screen under the video. Either size scrolls to read
// around the song, until Current Line; small, a tap expands it; back to small, it follows the song again
const useBandSize = ({
  band,
  expanded,
  follow,
  hasLines,
  onExpandedChange,
}: {
  band: boolean
  expanded: boolean
  follow: () => void
  hasLines: boolean
  onExpandedChange: ((expanded: boolean) => void) | undefined
}) => {
  const resize = (next: boolean) => {
    onExpandedChange?.(next)
    if (!next) {
      follow()
    }
  }
  const sizable = band && hasLines && onExpandedChange !== undefined
  const expandTap = useExpandTap(sizable, () => {
    resize(!expanded)
  })
  return {
    corner: sizable ? (
      <BandCorner expanded={expanded} onExpandedChange={resize} />
    ) : null,
    expandTap,
  }
}

export const LyricsPanel = ({
  videoId,
  version,
  heading = true,
  followAt = 0.3,
  band = false,
  expanded = false,
  onExpandedChange,
  className,
}: {
  videoId: string
  version: number | null
  // Where the line being sung sits while the panel follows it, as a share of the panel's height
  followAt?: number
  // Under a Lyrics tab the panel needs no title of its own
  heading?: boolean
  band?: boolean
  // The band filling the screen under the video (NarrowBelow owns it)
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  className?: string
}) => {
  const { limited, lines, loading } = useSongLines(videoId, version)
  const clock = useAtomValue(stageClockAtom)
  // The Japanese and the karaoke fill take the lyrics colour (Lyrics Style), as the lyrics over the video do
  const { accent } = getLyricsThemeColors(
    useAtomValue(lyricsThemeIdAtom),
    useAtomValue(lyricsCustomHueAtom)
  )
  const sheetVars: CssVars = { '--reader-accent': accent }
  const show: LineShow = {
    bold: false,
    japanese: useAtomValue(lyricsVisibilityAtom),
    language: useAtomValue(translationIsEnglishAtom) ? 'en' : 'zh',
    romaji: useAtomValue(romajiVisibilityAtom),
    translation: useAtomValue(translationVisibilityAtom),
  }

  const [active, setActive] = useState(-1)
  // The last line reached, which stays lit and followed through an instrumental gap; -1 before the first
  const [reached, setReached] = useState(-1)
  const handles = useRef<(KaraokeLineHandle | null)[]>([])
  const activeRef = useRef(-1)
  const reachedRef = useRef(-1)
  // The clock's last time and when it last moved on: a jump is a seek, and a clock that stands still is paused
  const lastTime = useRef(0)
  const lastAdvance = useRef(0)
  const { blocks, content, follow, following, handlers, scroller } =
    useLyricsFollow({
      centred: band,
      enabled: lines.length > 0,
      followAt,
      isPlaying: () =>
        performance.now() - lastAdvance.current < PAUSED_AFTER_MS,
      resumes: !band,
      // Before the first line, the first line waits in its place
      target: Math.max(reached, 0),
    })
  useEffect(
    () =>
      clock?.subscribeFrame((playerTime) => {
        // The overlay's lead over the player's clock, so the panel and the video agree
        const time = playerTime + lyricsLead(engineRate())
        if (playerTime !== lastTime.current) {
          if (Math.abs(playerTime - lastTime.current) > SEEK_JUMP_SEC) {
            follow()
          }
          lastTime.current = playerTime
          lastAdvance.current = performance.now()
        }
        const index = currentLineIndex(lines, time)
        if (index !== activeRef.current) {
          handles.current[activeRef.current]?.setTime(Infinity)
          activeRef.current = index
          setActive(index)
        }
        const last = lineReached(lines, time)
        if (last !== reachedRef.current) {
          reachedRef.current = last
          setReached(last)
        }
        handles.current[index]?.setTime(time)
      }),
    [clock, lines, follow]
  )
  const lit = active >= 0 ? active : reached
  const empty = emptyText({
    anyShown: show.japanese || show.romaji || show.translation,
    hasLines: lines.length > 0,
    limited,
    loading,
  })
  const { corner, expandTap } = useBandSize({
    band,
    expanded,
    follow,
    hasLines: empty === null,
    onExpandedChange,
  })
  const seek = (to: number) => {
    clock?.seek(to)
    follow()
  }

  return (
    <section
      aria-labelledby={heading ? 'lyrics-panel-title' : undefined}
      aria-label={heading ? undefined : 'Lyrics'}
      style={sheetVars}
      data-expanded={expanded || undefined}
      className={cn(
        'relative page-ruby flex min-h-0 flex-col overflow-hidden rounded-2xl bg-card text-(--reader-fg) lyrics-sheet',
        band ? 'watch-lyrics-band text-center' : !heading && 'pt-3',
        className
      )}>
      {heading && (
        <header className='flex h-12 shrink-0 items-center ps-4 pe-2'>
          <h2 id='lyrics-panel-title' className='text-base font-semibold'>
            Lyrics
          </h2>
        </header>
      )}
      {corner}
      {/* Over the panel's foot, in thumb reach, while the viewer reads elsewhere in the song */}
      {!following && empty === null && (
        <div className='pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center'>
          <span className='pointer-events-auto rounded-full shadow-lg'>
            <Button size='pill' gap='sm' onClick={follow}>
              <LocateFixedIcon className='size-4' aria-hidden />
              Current Line
            </Button>
          </span>
        </div>
      )}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a tap is a shortcut to Expand Lyrics, whose own button takes the keyboard */}
      <div
        ref={scroller}
        {...handlers}
        {...expandTap}
        // A scrolling box with nothing focusable inside takes focus itself, or a keyboard can't scroll it (WCAG 2.1.1)
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the scroll box itself is what the keys move
        tabIndex={0}
        className={cn(
          'focus-inset min-h-0 flex-1 px-4 font-reader [overflow-anchor:none]',
          scrollerLook(band, empty !== null)
        )}>
        <div ref={content}>
          {empty === null ? (
            lines.map((line, index) => (
              <LyricLineBlock
                // Lines are positional and never reorder
                // oxlint-disable-next-line no-array-index-key
                key={index}
                show={show}
                line={line}
                first={index === 0}
                synced
                // Under a video the lines are always karaoke: nothing reads as sung until it is sung, even
                // before the song starts
                phase={linePhase(index, lit, true)}
                blockRef={(element) => {
                  blocks.current[index] = element
                }}
                karaokeRef={(handle) => {
                  handles.current[index] = handle
                }}
                onSeek={band ? undefined : seek}
              />
            ))
          ) : (
            <EmptyLyrics videoId={videoId} text={empty} limited={limited} />
          )}
        </div>
      </div>
    </section>
  )
}
