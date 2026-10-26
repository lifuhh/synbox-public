import { useAtom } from 'jotai'
import {
  ALargeSmallIcon,
  AudioLinesIcon,
  BookOpenTextIcon,
  ChevronLeftIcon,
  LocateFixedIcon,
  MoonIcon,
  Rows3Icon,
  SunIcon,
  TvMinimalPlayIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import {
  linePhase,
  LyricLineBlock,
} from '@/components/offline/lyric-line-block'
import { PlaybackBar } from '@/components/offline/playback-bar'
import {
  LayersPanel,
  ReaderButton,
  TypeBar,
} from '@/components/offline/reader-controls'
import { useSyncedLyrics } from '@/components/offline/use-synced-lyrics'
import { useThemeColor } from '@/hooks/use-theme-color'
import {
  READER_SIZES,
  accentColor,
  colorHue,
  readerPrefsAtom,
} from '@/lib/offline/reader-prefs'
import type { OfflineLine, OfflineSong } from '@/lib/offline/song'
import { OFFLINE_SONG_VERSION } from '@/lib/offline/song'
import { useLyricsSong } from '@/lib/offline/sync'
import { useOnline } from '@/lib/pwa'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

type Panel = 'none' | 'layers' | 'type'

// How far the page scrolls in one direction before the bars hide or come back
const SCROLL_SLACK_PX = 8

const NO_LINES: OfflineLine[] = []

// The top bar: back, the song, and what a reader changes. In reader mode it slides away while reading down
const ReaderHeader = ({
  song,
  shown,
  panel,
  timed,
  onTogglePanel,
  onToggleMode,
  onBack,
  onReveal,
}: {
  song: OfflineSong | null
  shown: boolean
  panel: Panel
  // The song has timing, so it can play synced
  timed: boolean
  onTogglePanel: (panel: Panel) => void
  onToggleMode: () => void
  onBack: () => void
  // Keyboard focus landing in the bar while it is slid away brings it back
  onReveal: () => void
}) => {
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  return (
    <header
      onFocus={onReveal}
      className={cn(
        'absolute inset-x-0 top-0 z-40 border-b border-(--reader-line) bg-(--reader-bg) pt-safe-top pr-(--safe-right) pl-(--safe-left) transition-fade-translate duration-200 ease-out',
        !shown &&
          '-translate-y-full motion-reduce:translate-y-0 motion-reduce:opacity-0'
      )}>
      <div className='relative mx-auto flex h-13 max-w-3xl items-center gap-0.5 px-1.5 sm:px-3'>
        <ReaderButton label='Back' onClick={onBack}>
          <ChevronLeftIcon className='size-6' />
        </ReaderButton>
        <div className='min-w-0 flex-1 px-1'>
          <p className='truncate text-sm leading-tight font-semibold'>
            {song?.title}
          </p>
          <p className='truncate text-xs leading-tight text-(--reader-muted)'>
            {song?.author}
          </p>
        </div>
        {timed && (
          <ReaderButton
            label={prefs.mode === 'synced' ? 'Reader Mode' : 'Synced Lyrics'}
            onClick={onToggleMode}>
            {prefs.mode === 'synced' ? (
              <BookOpenTextIcon className='size-5' />
            ) : (
              <AudioLinesIcon className='size-5' />
            )}
          </ReaderButton>
        )}
        <ReaderButton
          label='Show Lines'
          pressed={panel === 'layers'}
          onClick={() => {
            onTogglePanel('layers')
          }}>
          <Rows3Icon className='size-5' />
        </ReaderButton>
        <ReaderButton
          label='Text Style'
          pressed={panel === 'type'}
          onClick={() => {
            onTogglePanel('type')
          }}>
          <ALargeSmallIcon className='size-5' />
        </ReaderButton>
        <ReaderButton
          label={prefs.theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          onClick={() => {
            setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })
          }}>
          {prefs.theme === 'dark' ? (
            <SunIcon className='size-5' />
          ) : (
            <MoonIcon className='size-5' />
          )}
        </ReaderButton>
        {panel === 'layers' && (
          <div className='absolute top-full right-1.5 mt-1.5 sm:right-3'>
            <LayersPanel />
          </div>
        )}
      </div>
    </header>
  )
}

// Online, the song itself is a tap away: the player, with the video and its sound
const WatchVideo = ({ videoId }: { videoId: string }) => (
  <Link
    to={`/v/${videoId}`}
    className='mt-3 inline-flex h-10 items-center gap-2 rounded-full border border-(--reader-line-strong) px-4 text-sm font-medium transition-colors hover:bg-(--reader-hover) touch:h-11'>
    <TvMinimalPlayIcon aria-hidden className='size-4' />
    Watch Video
  </Link>
)

const NotFound = () => {
  const online = useOnline()
  return (
    <div className='mx-auto flex max-w-sm flex-col items-center gap-4 px-6 pt-16 text-center'>
      <p className='text-base'>
        {online
          ? 'This song has no lyrics yet.'
          : 'This song isn’t saved on this device. Saved songs can be read offline.'}
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

// What sits at the bottom: the text style row when open, and the play controls when synced, with Current
// Line above them once the reader has scrolled away from the line being sung
const ReaderBottom = ({
  typeOpen,
  synced,
  following,
  onFollow,
  time,
  duration,
  playing,
  onSeek,
  onToggle,
}: {
  typeOpen: boolean
  synced: boolean
  following: boolean
  onFollow: () => void
  time: number
  duration: number
  playing: boolean
  onSeek: (time: number) => void
  onToggle: () => void
}) =>
  typeOpen || synced ? (
    <div className='absolute inset-x-0 bottom-0 z-20 border-t border-(--reader-line) bg-(--reader-bg) pr-(--safe-right) pb-(--safe-bottom) pl-(--safe-left)'>
      {synced && !following && (
        <button
          type='button'
          onClick={onFollow}
          className='absolute -top-14 left-1/2 flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-(--reader-fg) px-4 text-sm font-medium text-(--reader-bg) shadow-lg'>
          <LocateFixedIcon className='size-4' />
          Current Line
        </button>
      )}
      {typeOpen && <TypeBar />}
      {synced && (
        <PlaybackBar
          time={time}
          duration={duration}
          playing={playing}
          onSeek={onSeek}
          onToggle={onToggle}
        />
      )}
    </div>
  ) : null

// The bars and their panels. Reading, the bars hide on the way down and come back on the way up, like a book
// app, and a tap on the page shows or hides them; an open panel keeps them. Synced, the page scrolls itself and
// its controls stay
const useReaderBars = (synced: boolean) => {
  const [panel, setPanel] = useState<Panel>('none')
  const [barsShown, setBarsShown] = useState(true)
  const lastScroll = useRef(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanel('none')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const togglePanel = (next: Panel) => {
    setPanel((current) => (current === next ? 'none' : next))
    setBarsShown(true)
  }

  const onScroll = (event: React.UIEvent<HTMLElement>) => {
    const top = event.currentTarget.scrollTop
    const moved = top - lastScroll.current
    if (synced || Math.abs(moved) < SCROLL_SLACK_PX) {
      return
    }
    lastScroll.current = top
    if (panel === 'none') {
      setBarsShown(moved < 0 || top < 48)
    }
  }

  // A tap on the page shows or hides the bars, unless it selected text
  const onPageTap = () => {
    if (synced || (window.getSelection()?.toString() ?? '') !== '') {
      return
    }
    if (panel === 'none') {
      setBarsShown((shown) => !shown)
    } else {
      setPanel('none')
    }
  }

  const typeOpen = panel === 'type' && barsShown
  return {
    barsShown,
    onPageTap,
    onScroll,
    panel,
    setBarsShown,
    togglePanel,
    typeOpen,
  }
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
  const { data: song, isPending } = useLyricsSong(videoId)
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  const online = useOnline()
  const root = useRef<HTMLDivElement>(null)
  useThemeColor(root)

  // Songs saved before timing was kept read as plain text until the next sync fetches them again
  const timed = song?.version === OFFLINE_SONG_VERSION
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
  const {
    barsShown,
    onPageTap,
    onScroll,
    panel,
    setBarsShown,
    togglePanel,
    typeOpen,
  } = useReaderBars(synced)
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
  const readerVars: CssVars = {
    '--reader-accent':
      accentColor(prefs.theme, colorHue(prefs)) ?? 'var(--reader-fg)',
    '--reader-scale': READER_SIZES[prefs.size] ?? 1,
  }

  return (
    <div
      ref={root}
      data-reader
      data-theme={prefs.theme}
      style={readerVars}
      className='fixed inset-0 z-60 page-ruby flex flex-col bg-(--reader-bg) text-(--reader-fg) reader-paper'>
      <title>
        {song ? `${song.title} · Lyrics · Synbox` : 'Lyrics · Synbox'}
      </title>
      <div
        aria-hidden='true'
        className='status-scrim absolute inset-x-0 top-0 z-30 bg-(--reader-status)'
      />

      <ReaderHeader
        song={song ?? null}
        shown={barsShown}
        panel={panel}
        timed={timed}
        onTogglePanel={togglePanel}
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
          'flex-1 overflow-y-auto overscroll-contain scroll-auto pt-reader-top pr-(--safe-right) pl-(--safe-left)',
          synced && 'pb-reader-follow',
          !synced && (typeOpen ? 'pb-reader-bottom-bar' : 'pb-reader-bottom')
        )}>
        {song ? (
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- a tap anywhere toggles the bars; every control is also a button in them
          <article
            ref={content}
            onClick={onPageTap}
            className='mx-auto max-w-xl px-5 font-reader'>
            <header className='pb-5'>
              <h1 className='text-reader-title font-semibold'>{song.title}</h1>
              {song.author !== '' && (
                <p className='pt-0.5 text-xs text-(--reader-muted)'>
                  {song.author}
                </p>
              )}
              {online && <WatchVideo videoId={song.videoId} />}
            </header>
            {song.lines.map((line, index) => (
              <LyricLineBlock
                // Lines are positional and never reorder
                // oxlint-disable-next-line no-array-index-key
                key={index}
                show={prefs}
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
        ) : (
          !isPending && <NotFound />
        )}
      </div>

      <ReaderBottom
        typeOpen={typeOpen}
        synced={synced}
        following={following}
        onFollow={follow}
        time={playedTime}
        duration={duration}
        playing={playback.playing}
        onSeek={seek}
        onToggle={togglePlay}
      />
    </div>
  )
}

export default ReaderPage
