import { useAtom } from 'jotai'
import {
  AudioLinesIcon,
  ChevronLeftIcon,
  LocateFixedIcon,
  MoonIcon,
  SunIcon,
  TvMinimalPlayIcon,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import type { LineShow } from '@/components/offline/lyric-line-block'
import {
  linePhase,
  LyricLineBlock,
} from '@/components/offline/lyric-line-block'
import { PlaybackBar } from '@/components/offline/playback-bar'
import {
  ReaderButton,
  useTextLines,
  useVideoColor,
} from '@/components/offline/reader-controls'
import { useSyncedLyrics } from '@/components/offline/use-synced-lyrics'
import LoadError from '@/components/shared/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TextStyleButton,
  useTextStyleOpen,
} from '@/components/watch/text-style'
import { useThemeColor } from '@/hooks/use-theme-color'
import {
  READER_SIZES,
  readerColor,
  readerPrefsAtom,
} from '@/lib/offline/reader-prefs'
import type { OfflineLine, OfflineSong } from '@/lib/offline/song'
import { isTimed } from '@/lib/offline/song'
import { useLyricsSong } from '@/lib/offline/sync'
import { useOnline } from '@/lib/pwa'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

// How far the page scrolls in one direction before the bars hide or come back
const SCROLL_SLACK_PX = 8

const NO_LINES: OfflineLine[] = []

// The bar's buttons on the lyrics' column: the back chevron's drawing starts on its left edge and the last icon's ends
// on its right, so the boxes hang into the margin by the gap around each glyph (16px of 40, 18 of 44 for the
// chevron; 10 and 12 for the sun and moon)
const HANG_START = '-ml-4 touch:-ml-4.5'
const HANG_END = '-mr-2.5 touch:-mr-3'

// The top bar: back, the song once its title has scrolled under the bar, and what a reader changes. In reader mode
// it slides away while reading down
const ReaderHeader = ({
  song,
  shown,
  titleShown,
  timed,
  synced,
  onToggleMode,
  onBack,
  onReveal,
  ref,
}: {
  ref: React.Ref<HTMLElement>
  song: OfflineSong | null
  shown: boolean
  // The page's own title has scrolled up under the bar
  titleShown: boolean
  // The song has timing, so it can play synced
  timed: boolean
  synced: boolean
  onToggleMode: () => void
  onBack: () => void
  // Keyboard focus landing in the bar while it is slid away brings it back
  onReveal: () => void
}) => {
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  return (
    <header
      ref={ref}
      onFocus={onReveal}
      className={cn(
        'absolute inset-x-0 top-0 z-40 border-b border-(--reader-line) bg-(--reader-bg) pt-safe-top pr-(--safe-right) pl-(--safe-left) transition-fade-translate duration-200 ease-out',
        !shown &&
          '-translate-y-full motion-reduce:translate-y-0 motion-reduce:opacity-0'
      )}>
      <div className='mx-auto flex h-13 max-w-xl items-center gap-0.5 px-5'>
        <ReaderButton label='Back' onClick={onBack} className={HANG_START}>
          <ChevronLeftIcon className='size-6' />
        </ReaderButton>
        <div
          aria-hidden={!titleShown}
          className={cn(
            'min-w-0 flex-1 px-1 transition-opacity duration-150 motion-reduce:transition-none',
            !titleShown && 'opacity-0'
          )}>
          <p className='truncate text-sm leading-tight font-semibold'>
            {song?.title}
          </p>
          <p className='truncate text-xs leading-tight text-(--reader-muted)'>
            {song?.author}
          </p>
        </div>
        {timed && (
          <ReaderButton
            label='Synced Lyrics'
            pressed={synced}
            onClick={onToggleMode}>
            <AudioLinesIcon className='size-5' />
          </ReaderButton>
        )}
        <TextStyleButton paper={prefs.theme} />
        <ReaderButton
          label={prefs.theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          className={HANG_END}
          onClick={() => {
            setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })
          }}>
          {prefs.theme === 'dark' ? (
            <SunIcon className='size-5' />
          ) : (
            <MoonIcon className='size-5' />
          )}
        </ReaderButton>
      </div>
    </header>
  )
}

// Online, the song itself is a tap away: the player, with the video and its sound
const WatchVideo = ({ videoId }: { videoId: string }) => (
  <Link
    to={`/v/${videoId}`}
    className='ml-auto inline-flex h-10 shrink-0 label-icons items-center gap-2 rounded-full border border-(--reader-line-strong) px-4 text-sm font-medium transition-colors hover:bg-(--reader-hover) touch:h-11'>
    <TvMinimalPlayIcon aria-hidden className='size-4' />
    Watch Video
  </Link>
)

// What the song has: none saved for offline, or no lyrics at all
const NotFound = () => {
  const online = useOnline()
  return (
    <div className='mx-auto flex max-w-sm flex-col items-center gap-4 px-6 pt-16 text-center'>
      <p className='text-base'>
        {online
          ? 'This song has no lyrics yet'
          : 'This song isn’t saved for offline'}
      </p>
      <Link
        to='/library'
        replace
        className='rounded-full border border-(--reader-line-strong) px-4 py-2 text-sm font-medium'>
        Library
      </Link>
    </div>
  )
}

// How wide each skeleton block's lines are, so the bars read as lines of different lengths
const SKELETON_WIDTHS = ['80%', '60%', '92%', '66%', '75%', '50%']

// The page while its lyrics load: the title and artist, then blocks of the lines Text Style shows, each a bar at its
// line's size and pitch, so nothing moves when the words land
const ReaderSkeleton = ({ show }: { show: LineShow }) => (
  <div aria-busy className='mx-auto max-w-xl px-5'>
    <div className='flex flex-col gap-1 pb-5'>
      <div className='flex h-[1lh] items-center text-reader-title'>
        <Skeleton className='h-[0.8em] w-3/4' />
      </div>
      <div className='flex min-h-10 items-center touch:min-h-11'>
        <Skeleton className='h-3 w-1/3' />
      </div>
    </div>
    {SKELETON_WIDTHS.map((width) => {
      const barVars: CssVars = { '--bar': width }
      return (
        <div
          key={width}
          style={barVars}
          className='flex flex-col pb-reader-line'>
          {show.japanese && (
            <div className='flex h-[1lh] items-center text-reader-ja'>
              <Skeleton className='h-[0.8em] w-(--bar)' />
            </div>
          )}
          {show.romaji && (
            <div className='flex h-[1lh] items-center text-reader-romaji'>
              <Skeleton className='h-[0.7em] w-(--bar)' />
            </div>
          )}
          {show.translation && (
            <div className='flex h-[1lh] items-center text-reader-translation'>
              <Skeleton className='h-[0.7em] w-1/2' />
            </div>
          )}
        </div>
      )
    })}
    <span className='sr-only'>Loading</span>
  </div>
)

// The play controls when synced, with Current Line above them once the reader has scrolled away from the line
// being sung
const ReaderBottom = ({
  following,
  onFollow,
  time,
  duration,
  playing,
  onSeek,
  onToggle,
}: {
  following: boolean
  onFollow: () => void
  time: number
  duration: number
  playing: boolean
  onSeek: (time: number) => void
  onToggle: () => void
}) => (
  <div className='absolute inset-x-0 bottom-0 z-20 border-t border-(--reader-line) bg-(--reader-bg) pr-(--safe-right) pb-(--safe-bottom) pl-(--safe-left)'>
    {!following && (
      <button
        type='button'
        onClick={onFollow}
        className='absolute -top-14 left-1/2 flex h-10 -translate-x-1/2 label-icons items-center gap-1.5 rounded-full bg-(--reader-fg) px-4 text-sm font-medium text-(--reader-bg) shadow-lg'>
        <LocateFixedIcon className='size-4' />
        Current Line
      </button>
    )}
    <PlaybackBar
      time={time}
      duration={duration}
      playing={playing}
      onSeek={onSeek}
      onToggle={onToggle}
    />
  </div>
)

// The bars. Reading, they hide on the way down and come back on the way up, like a book app, and a tap on the page
// shows or hides them; an open Text Style keeps them. Synced, the page scrolls itself and its controls stay
const useReaderBars = (synced: boolean) => {
  const styleOpen = useTextStyleOpen()
  const [barsShown, setBarsShown] = useState(true)
  const lastScroll = useRef(0)
  // Text Style was open when the tap began: that tap closed it, and leaves the bars as they are
  const styleOpenAtPress = useRef(false)

  const onScroll = (event: React.UIEvent<HTMLElement>) => {
    const top = event.currentTarget.scrollTop
    const moved = top - lastScroll.current
    if (synced || Math.abs(moved) < SCROLL_SLACK_PX) {
      return
    }
    lastScroll.current = top
    if (!styleOpen) {
      setBarsShown(moved < 0 || top < 48)
    }
  }

  const onPagePress = () => {
    styleOpenAtPress.current = styleOpen
  }

  // A tap on the page shows or hides the bars, unless it selected text or closed Text Style
  const onPageTap = () => {
    if (
      synced ||
      styleOpenAtPress.current ||
      (window.getSelection()?.toString() ?? '') !== ''
    ) {
      return
    }
    setBarsShown((shown) => !shown)
  }

  return { barsShown, onPagePress, onPageTap, onScroll, setBarsShown }
}

// Whether the page's title has scrolled up under the bar, so the bar names the song instead. `watch` is the title's
// ref: it watches the title while it is on the page
const useTitleUnderBar = (
  scroller: React.RefObject<HTMLElement | null>,
  bar: React.RefObject<HTMLElement | null>
) => {
  const [under, setUnder] = useState(false)
  const watch = useCallback(
    (title: HTMLElement | null) => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry !== undefined) {
            setUnder(
              !entry.isIntersecting &&
                entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)
            )
          }
        },
        {
          root: scroller.current,
          rootMargin: `-${bar.current?.offsetHeight ?? 0}px 0px 0px 0px`,
        }
      )
      if (title !== null) {
        observer.observe(title)
      }
      return () => {
        observer.disconnect()
        setUnder(false)
      }
    },
    [scroller, bar]
  )
  return { titleUnder: under, watchTitle: watch }
}

const useGoBack = () => {
  const navigate = useNavigate()
  const location = useLocation()
  return () => {
    // Opened from a link or a reload, there is no page of ours to go back to
    if (location.key === 'default') {
      void navigate('/library', { replace: true })
    } else {
      void navigate(-1)
    }
  }
}

const ReaderPage = () => {
  const { videoId = '' } = useParams()
  const {
    data: song,
    isPending,
    isError,
    isRefetching,
    refetch,
  } = useLyricsSong(videoId)
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  const online = useOnline()
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLElement>(null)
  useThemeColor(root)

  const timed = song !== undefined && song !== null && isTimed(song)
  const synced = timed && prefs.mode === 'synced'
  const {
    lit,
    duration,
    following,
    karaokeLines,
    playback,
    playedTime,
    blocks,
    content,
    scroller,
    follow,
    followHandlers,
    seek,
    togglePlay,
  } = useSyncedLyrics(song?.lines ?? NO_LINES, synced)
  const { barsShown, onPagePress, onPageTap, onScroll, setBarsShown } =
    useReaderBars(synced)
  const { titleUnder, watchTitle } = useTitleUnderBar(scroller, bar)
  const goBack = useGoBack()
  // Until it starts, the whole song reads at full strength
  const started = synced && (playback.playing || playedTime > 0)
  const toggleMode = () => {
    if (prefs.mode === 'synced') {
      playback.pause()
    }
    setBarsShown(true)
    setPrefs({ mode: prefs.mode === 'synced' ? 'reader' : 'synced' })
  }
  const show = useTextLines()
  const video = useVideoColor()
  const readerVars: CssVars = {
    '--reader-accent':
      readerColor({ id: prefs.color, prefs, theme: prefs.theme, video }) ??
      'var(--reader-fg)',
    '--reader-scale': READER_SIZES[prefs.size] ?? 1,
  }

  const body = () => {
    if (song) {
      return (
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- a tap anywhere toggles the bars; every control is also a button in them
        <article
          ref={content}
          onPointerDown={onPagePress}
          onClick={onPageTap}
          className='mx-auto max-w-xl px-5 font-reader'>
          <header className='flex flex-col gap-1 pb-5'>
            <h1
              ref={watchTitle}
              className='text-reader-title font-semibold select-text'>
              {song.title}
            </h1>
            {(song.author !== '' || online) && (
              <div className='flex min-h-10 items-center gap-3 touch:min-h-11'>
                {song.author !== '' && (
                  <p className='min-w-0 text-caption text-(--reader-muted)'>
                    {song.author}
                  </p>
                )}
                {online && <WatchVideo videoId={song.videoId} />}
              </div>
            )}
          </header>
          {song.lines.map((line, index) => (
            <LyricLineBlock
              // Lines are positional and never reorder
              // oxlint-disable-next-line no-array-index-key
              key={index}
              show={show}
              line={line}
              first={index === 0}
              synced={synced}
              phase={linePhase(index, lit, started)}
              blockRef={(element) => {
                blocks.current[index] = element
              }}
              karaokeRef={(handle) => {
                karaokeLines.current[index] = handle
              }}
              onSeek={seek}
            />
          ))}
        </article>
      )
    }
    if (isPending) {
      return <ReaderSkeleton show={show} />
    }
    // A failed fetch is not a song without lyrics: say what failed and offer another try
    if (isError) {
      return (
        <LoadError
          message='Couldn’t load the lyrics'
          retrying={isRefetching}
          onRetry={() => {
            void refetch()
          }}
          className='mx-auto max-w-sm pt-16'
        />
      )
    }
    return <NotFound />
  }

  return (
    <div
      ref={root}
      data-reader
      data-theme={prefs.theme}
      style={readerVars}
      className='fixed inset-0 z-60 page-ruby flex flex-col bg-(--reader-bg) text-(--reader-fg) reader-paper reader-surface'>
      <title>
        {song ? `${song.title} · Lyrics · Synbox` : 'Lyrics · Synbox'}
      </title>
      <div
        aria-hidden='true'
        className='status-scrim absolute inset-x-0 top-0 z-30 bg-(--reader-status)'
      />

      <ReaderHeader
        ref={bar}
        song={song ?? null}
        shown={barsShown}
        titleShown={titleUnder}
        timed={timed}
        synced={synced}
        onToggleMode={toggleMode}
        onBack={goBack}
        onReveal={() => {
          setBarsShown(true)
        }}
      />

      <div
        ref={scroller}
        {...followHandlers}
        onScroll={(event) => {
          onScroll(event)
          followHandlers.onScroll()
        }}
        className={cn(
          'flex-1 scroll-gutter-both overflow-y-auto overscroll-contain scroll-auto pt-reader-top pr-(--safe-right) pl-(--safe-left)',
          synced ? 'pb-reader-follow' : 'pb-reader-bottom'
        )}>
        {body()}
      </div>

      {synced && (
        <ReaderBottom
          following={following}
          onFollow={follow}
          time={playedTime}
          duration={duration}
          playing={playback.playing}
          onSeek={seek}
          onToggle={togglePlay}
        />
      )}
    </div>
  )
}

export default ReaderPage
