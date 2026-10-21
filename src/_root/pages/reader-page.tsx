import { useAtom, useAtomValue } from 'jotai'
import {
  ALargeSmallIcon,
  ChevronLeftIcon,
  MoonIcon,
  Rows3Icon,
  SunIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { RubyText } from '@/components/lyrics-display/ruby-text'
import {
  LayersPanel,
  ReaderButton,
  TypeBar,
} from '@/components/offline/reader-controls'
import {
  READER_SIZES,
  accentColor,
  colorHue,
  readerPrefsAtom,
} from '@/lib/offline/reader-prefs'
import type { OfflineLine } from '@/lib/offline/song'
import { useOfflineSong } from '@/lib/offline/sync'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

type Panel = 'none' | 'layers' | 'type'

// How far the page scrolls in one direction before the bars hide or come back
const SCROLL_SLACK_PX = 8

// One sung line as a block: the Japanese and its romaji, then the translation. Wide landscape screens put
// the translation beside them, so a line reads across rather than down
const ReaderLine = ({
  line,
  first,
  split,
}: {
  line: OfflineLine
  first: boolean
  split: boolean
}) => {
  const prefs = useAtomValue(readerPrefsAtom)
  const translation = prefs.language === 'en' ? line.en : line.zh
  const source = prefs.japanese || (prefs.romaji && line.romaji !== '')
  return (
    <div
      className={cn(
        'grid gap-y-0.5 pb-reader-line',
        split && 'landscape:sm:grid-cols-2 landscape:sm:gap-x-12',
        line.stanza && !first && 'pt-reader-stanza'
      )}>
      {source && (
        <div>
          {prefs.japanese && (
            <p
              lang='ja'
              className={cn(
                'font-reader-ja text-reader-ja text-(--reader-accent)',
                prefs.bold ? 'font-bold' : 'font-normal'
              )}>
              <RubyText segments={line.ruby} />
            </p>
          )}
          {prefs.romaji && line.romaji !== '' && (
            <p
              className={cn(
                'text-reader-romaji text-(--reader-muted) italic',
                prefs.bold ? 'font-semibold' : 'font-normal'
              )}>
              {line.romaji}
            </p>
          )}
        </div>
      )}
      {prefs.translation && translation !== '' && (
        <p
          lang={prefs.language}
          className={cn(
            'font-reader-serif text-reader-translation',
            source && 'pt-1 landscape:sm:pt-0',
            prefs.bold ? 'font-semibold' : 'font-normal'
          )}>
          {translation}
        </p>
      )}
    </div>
  )
}

// The top bar: back, the song, and the three things a reader changes. It slides away while reading down
const ReaderHeader = ({
  title,
  author,
  shown,
  panel,
  onTogglePanel,
  onBack,
}: {
  title: string
  author: string
  shown: boolean
  panel: Panel
  onTogglePanel: (panel: Panel) => void
  onBack: () => void
}) => {
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  return (
    <header
      className={cn(
        'absolute inset-x-0 top-0 z-20 border-b border-(--reader-line) bg-(--reader-bg) pt-safe-top pr-(--safe-right) pl-(--safe-left) transition-transform duration-200 ease-out',
        !shown && '-translate-y-full'
      )}>
      <div className='relative mx-auto flex h-13 max-w-3xl items-center gap-0.5 px-1.5 sm:px-3'>
        <ReaderButton label='Back' onClick={onBack}>
          <ChevronLeftIcon className='size-6' />
        </ReaderButton>
        <div className='min-w-0 flex-1 px-1'>
          <p className='truncate text-sm leading-tight font-semibold'>
            {title}
          </p>
          <p className='truncate text-xs leading-tight text-(--reader-muted)'>
            {author}
          </p>
        </div>
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

const ReaderPage = () => {
  const { videoId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: song, isPending } = useOfflineSong(videoId)
  const prefs = useAtomValue(readerPrefsAtom)
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

  const goBack = () => {
    // Opened from a link or a reload, there is no page of ours to go back to
    if (location.key === 'default') {
      void navigate('/offline', { replace: true })
    } else {
      void navigate(-1)
    }
  }

  const togglePanel = (next: Panel) => {
    setPanel((current) => (current === next ? 'none' : next))
    setBarsShown(true)
  }

  // Bars hide while reading down and come back on the way up, like a book app; an open panel keeps them
  const onScroll = (event: React.UIEvent<HTMLElement>) => {
    const top = event.currentTarget.scrollTop
    const moved = top - lastScroll.current
    if (Math.abs(moved) < SCROLL_SLACK_PX) {
      return
    }
    lastScroll.current = top
    if (panel === 'none') {
      setBarsShown(moved < 0 || top < 48)
    }
  }

  // A tap on the page shows or hides the bars, unless it selected text
  const onPageTap = () => {
    if ((window.getSelection()?.toString() ?? '') !== '') {
      return
    }
    if (panel === 'none') {
      setBarsShown((shown) => !shown)
    } else {
      setPanel('none')
    }
  }

  const split = (prefs.japanese || prefs.romaji) && prefs.translation
  const typeOpen = panel === 'type' && barsShown
  const readerVars: CssVars = {
    '--reader-accent':
      accentColor(prefs.theme, colorHue(prefs)) ?? 'var(--reader-fg)',
    '--reader-scale': READER_SIZES[prefs.size] ?? 1,
  }

  return (
    <div
      data-reader
      data-theme={prefs.theme}
      style={readerVars}
      className='fixed inset-0 z-60 flex flex-col bg-(--reader-bg) text-(--reader-fg) reader-paper'>
      <title>{song ? `${song.title} · Lyrics` : 'Lyrics · Synbox'}</title>
      <div
        aria-hidden='true'
        className='absolute inset-x-0 top-0 z-30 h-safe-top bg-(--reader-status)'
      />

      <ReaderHeader
        title={song?.title ?? ''}
        author={song?.author ?? ''}
        shown={barsShown}
        panel={panel}
        onTogglePanel={togglePanel}
        onBack={goBack}
      />

      <main
        onScroll={onScroll}
        className={cn(
          'flex-1 overflow-y-auto overscroll-contain scroll-auto pt-reader-top pr-(--safe-right) pl-(--safe-left)',
          typeOpen ? 'pb-reader-bottom-bar' : 'pb-reader-bottom'
        )}>
        {song ? (
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- a tap anywhere toggles the bars; every control is also a button in them
          <article
            onClick={onPageTap}
            className={cn(
              'mx-auto max-w-2xl px-6 sm:px-8',
              split && 'landscape:sm:max-w-5xl'
            )}>
            <header className='pt-4 pb-10 text-center'>
              <h1 className='font-reader-serif text-reader-title font-semibold text-balance'>
                {song.title}
              </h1>
              {song.author !== '' && (
                <p className='mt-2 text-xs font-medium tracking-widest text-(--reader-muted) uppercase'>
                  {song.author}
                </p>
              )}
              <div className='mx-auto mt-7 h-px w-16 bg-(--reader-line-strong)' />
            </header>
            {song.lines.map((line, index) => (
              <ReaderLine
                // Lines are positional and never reorder
                // oxlint-disable-next-line no-array-index-key
                key={index}
                line={line}
                first={index === 0}
                split={split}
              />
            ))}
          </article>
        ) : (
          !isPending && (
            <div className='mx-auto flex max-w-sm flex-col items-center gap-4 px-6 pt-16 text-center'>
              <p className='text-base'>
                This song isn&apos;t saved on this device.
              </p>
              <Link
                to='/offline'
                replace
                className='rounded-full border border-(--reader-line-strong) px-4 py-2 text-sm font-medium'>
                Offline Lyrics
              </Link>
            </div>
          )
        )}
      </main>

      {typeOpen && (
        <div className='absolute inset-x-0 bottom-0 z-20 border-t border-(--reader-line) bg-(--reader-bg) pr-(--safe-right) pb-(--safe-bottom) pl-(--safe-left)'>
          <TypeBar />
        </div>
      )}
    </div>
  )
}

export default ReaderPage
