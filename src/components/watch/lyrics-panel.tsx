import { useAtomValue } from 'jotai'
import { LocateFixedIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { KaraokeLineHandle } from '@/components/lyrics-display/karaoke-line'
import type { LineShow } from '@/components/offline/lyric-line-block'
import { LyricLineBlock } from '@/components/offline/lyric-line-block'
import { parseLyricsText } from '@/components/player-stage/stage-lyrics'
import { Button } from '@/components/ui/button'
import {
  lyricsVisibilityAtom,
  romajiVisibilityAtom,
  stageClockAtom,
  translationIsEnglishAtom,
  translationVisibilityAtom,
} from '@/context/atoms'
import { currentLineIndex, karaokeMatchesLyrics } from '@/lib/karaoke'
import { parseLyricsDocument } from '@/lib/lyrics-document'
import type { OfflineLine } from '@/lib/offline/song'
import { offlineLines } from '@/lib/offline/song'
import {
  useGetKaraokeById,
  useGetLyricsBySongId,
  useGetLyricsVersion,
} from '@/lib/react-query/queries-and-mutations'
import { cn } from '@/utils/cn'

// The overlay's lead over the player's clock (stage-lyrics), so the panel and the video agree
const LEAD_SEC = 0.15
// Where the line being sung sits while the panel follows it
const FOLLOW_AT = 0.3
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

// The whole song beside or under the video: the line being sung lights up and fills as it is sung, the panel
// follows it until the viewer scrolls, and a tap on a line plays from there. The same toggles as the
// player's rail choose the rows
export const LyricsPanel = ({
  videoId,
  version,
  heading = true,
  className,
}: {
  videoId: string
  version: number | null
  // Under a Lyrics tab the panel needs no title of its own
  heading?: boolean
  className?: string
}) => {
  const { lines, loading } = useSongLines(videoId, version)
  const clock = useAtomValue(stageClockAtom)
  const show: LineShow = {
    bold: false,
    japanese: useAtomValue(lyricsVisibilityAtom),
    language: useAtomValue(translationIsEnglishAtom) ? 'en' : 'zh',
    romaji: useAtomValue(romajiVisibilityAtom),
    translation: useAtomValue(translationVisibilityAtom),
  }

  const [active, setActive] = useState(-1)
  const [started, setStarted] = useState(false)
  const handles = useRef<(KaraokeLineHandle | null)[]>([])
  const blocks = useRef<(HTMLDivElement | null)[]>([])
  const activeRef = useRef(-1)
  const startedRef = useRef(false)
  useEffect(
    () =>
      clock?.subscribeFrame((playerTime) => {
        const time = playerTime + LEAD_SEC
        const index = currentLineIndex(lines, time)
        if (index !== activeRef.current) {
          handles.current[activeRef.current]?.setTime(Infinity)
          activeRef.current = index
          setActive(index)
        }
        if (playerTime > 0 && !startedRef.current) {
          startedRef.current = true
          setStarted(true)
        }
        handles.current[index]?.setTime(time)
      }),
    [clock, lines]
  )

  // Follows the line being sung until the viewer scrolls the panel; Current Line or a tap picks it back up
  const [following, setFollowing] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    const block = blocks.current[active]
    if (!following || box === null || block === undefined || block === null) {
      return
    }
    box.scrollTo({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      top:
        box.scrollTop +
        block.getBoundingClientRect().top -
        box.getBoundingClientRect().top -
        box.clientHeight * FOLLOW_AT,
    })
  }, [active, following])
  const userScrolled = () => {
    setFollowing(false)
  }
  const seek = (to: number) => {
    clock?.seek(to)
    setFollowing(true)
  }

  return (
    <section
      aria-labelledby={heading ? 'lyrics-panel-title' : undefined}
      aria-label={heading ? undefined : 'Lyrics'}
      className={cn(
        'relative page-ruby flex min-h-0 flex-col overflow-hidden rounded-2xl bg-card text-(--reader-fg) lyrics-sheet',
        !heading && 'pt-3',
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
      {!following && active >= 0 && (
        <div className='pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center'>
          <span className='pointer-events-auto rounded-full shadow-lg'>
            <Button
              size='pill'
              gap='sm'
              onClick={() => {
                setFollowing(true)
              }}>
              <LocateFixedIcon className='size-4' aria-hidden />
              Current Line
            </Button>
          </span>
        </div>
      )}
      <div
        ref={scroller}
        onWheel={userScrolled}
        onTouchMove={userScrolled}
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-48 font-reader'>
        {lines.length === 0 ? (
          <p className='py-6 text-sm text-muted-foreground'>
            {loading ? '' : 'No lyrics for this song yet.'}
          </p>
        ) : (
          lines.map((line, index) => (
            <LyricLineBlock
              // Lines are positional and never reorder
              // oxlint-disable-next-line no-array-index-key
              key={index}
              show={show}
              line={line}
              first={index === 0}
              synced
              dimmed={started && index !== active}
              blockRef={(element) => {
                blocks.current[index] = element
              }}
              karaokeRef={(handle) => {
                handles.current[index] = handle
              }}
              onSeek={seek}
            />
          ))
        )}
      </div>
    </section>
  )
}
