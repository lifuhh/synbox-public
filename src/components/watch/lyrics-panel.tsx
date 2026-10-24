import { useAtomValue, useSetAtom } from 'jotai'
import { LocateFixedIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { KaraokeLineHandle } from '@/components/lyrics-display/karaoke-line'
import type { LineShow } from '@/components/offline/lyric-line-block'
import {
  linePhase,
  LyricLineBlock,
} from '@/components/offline/lyric-line-block'
import { useLyricsFollow } from '@/components/offline/use-lyrics-follow'
import { lineReached } from '@/components/offline/use-silent-playback'
import { parseLyricsText } from '@/components/player-stage/stage-lyrics'
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

// The overlay's lead over the player's clock (stage-lyrics), so the panel and the video agree
const LEAD_SEC = 0.15
// A clock that jumps further than this between frames was seeked (from the video, the bar or a key)
const SEEK_JUMP_SEC = 1.5
// A clock that hasn't moved for this long is paused
const PAUSED_AFTER_MS = 500
// A press held longer than this is the start of a look around the song, not a tap
const TAP_MAX_MS = 500
const NO_LINES: OfflineLine[] = []

// The song's lines as the reader draws them, with karaoke timing where it was made for exactly these lines
const useSongLines = (videoId: string, version: number | null) => {
  const { data: activeLyrics, isPending } = useGetLyricsBySongId(
    version === null ? videoId : ''
  )
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
  return { lines, loading: version === null && isPending }
}

// A tap on the band opens Lyrics Style; a press held longer is the start of a look around the song. Only over
// lines (`on`): with none there is nothing to style, and a press on a disabled Generate Lyrics (which takes no
// pointer events) would fall through to it
const useStyleTap = (on: boolean) => {
  const setStylePanel = useSetAtom(lyricsStylePanelAtom)
  const pressedAt = useRef(0)
  if (!on) {
    return {}
  }
  return {
    onClick: () => {
      if (performance.now() - pressedAt.current < TAP_MAX_MS) {
        setStylePanel('pinned')
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
    return '[mask-image:linear-gradient(to_bottom,transparent,#000_1.25rem)] pt-5 pb-16'
  }
  return empty ? 'grid place-items-center' : 'watch-lyrics-band-scroller'
}

// The whole song beside or under the video: the line being sung lights up and fills as it is sung, the panel
// follows it until the viewer scrolls, and a tap on a line plays from there. The same toggles as the
// player's rail choose the rows.
// As a band (under the video on a phone held upright) it is a karaoke window instead: the sung line centred at
// the Lyrics Style size, the lines either side fading out at its edges, and a tap opens Lyrics Style, never a
// seek. Holding and scrolling reads elsewhere until Current Line or a seek, while the song plays on
// Why the panel has no lines. A chart song (Top 100 Japan, not in Synbox yet) offers its lyrics where they
// would be
const EmptyLyrics = ({ videoId, text }: { videoId: string; text: string }) => {
  const chart = useAtomValue(chartSongAtom)?.videoId === videoId
  const title = useAtomValue(currentVideoAtom)?.title
  if (!chart) {
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

export const LyricsPanel = ({
  videoId,
  version,
  heading = true,
  followAt = 0.3,
  band = false,
  className,
}: {
  videoId: string
  version: number | null
  // Where the line being sung sits while the panel follows it, as a share of the panel's height
  followAt?: number
  // Under a Lyrics tab the panel needs no title of its own
  heading?: boolean
  band?: boolean
  className?: string
}) => {
  const { lines, loading } = useSongLines(videoId, version)
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
        const time = playerTime + LEAD_SEC
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
  let empty: string | null = null
  if (lines.length === 0) {
    empty = loading ? '' : 'No lyrics for this song yet.'
  } else if (!(show.japanese || show.romaji || show.translation)) {
    empty = 'Lyrics, Romaji and Translation are all turned off.'
  }
  const styleTap = useStyleTap(band && empty === null)
  const seek = (to: number) => {
    clock?.seek(to)
    follow()
  }

  return (
    <section
      aria-labelledby={heading ? 'lyrics-panel-title' : undefined}
      aria-label={heading ? undefined : 'Lyrics'}
      style={sheetVars}
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
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a tap is a shortcut to Lyrics Style, whose own button takes the keyboard */}
      <div
        ref={scroller}
        {...handlers}
        {...styleTap}
        // A scrolling box with nothing focusable inside takes focus itself, or a keyboard can't scroll it (WCAG 2.1.1)
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-4 font-reader [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset',
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
            <EmptyLyrics videoId={videoId} text={empty} />
          )}
        </div>
      </div>
    </section>
  )
}
