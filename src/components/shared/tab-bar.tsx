import { useAtom } from 'jotai'
import {
  CircleUserRoundIcon,
  HouseIcon,
  LibraryBigIcon,
  PlayIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { MouseEvent } from 'react'
import { Link, useLocation } from 'react-router'

import { resumeSongAtom, songPath } from '@/lib/listening/store'
import { applyWaitingUpdate, isInstalledPhone } from '@/lib/pwa'
import { scrollMotion } from '@/lib/reduced-motion'
import { tabTap } from '@/lib/tab-tap'
import { cn } from '@/utils/cn'

// `also`: other pages the tab is the home of (playlists open from the Library)
// A tab is current on its own page, and on the pages it is the home of; NavLink's own aria-current would leave
// those out
const TABS: {
  to: string
  label: string
  icon: LucideIcon
  also?: RegExp
}[] = [
  { icon: HouseIcon, label: 'Home', to: '/' },
  { icon: SearchIcon, label: 'Search', to: '/search' },
  {
    also: /^\/playlists/u,
    icon: LibraryBigIcon,
    label: 'Library',
    to: '/library',
  },
  { icon: CircleUserRoundIcon, label: 'You', to: '/you' },
]

// The player, a song's reader and the admin pages own the whole screen; every other page gets the tabs
const TAB_PAGES = /^\/(?:search|library|you|playlists(?:\/[^/]+)?|about)?$/u

// The page's scroller: its box marked data-scroll-top, else the document
const pageScroller = () =>
  document.querySelector<HTMLElement>('[data-scroll-top]') ??
  document.scrollingElement

// Within this many pixels of the top counts as at the top (iOS reports a pull past the top as negative)
const TOP_SLACK_PX = 2

// Back to the song opened last: its picture and title, a tap away from any tab
const ResumeBar = () => {
  const [song, setSong] = useAtom(resumeSongAtom)
  if (song === null) {
    return null
  }
  return (
    <div
      data-resume-box
      className='flex h-14 items-center gap-1 rounded-2xl bg-popover/90 p-1.5 shadow-lg ring-1 ring-white/10 backdrop-blur-xl'>
      <Link
        to={songPath(song.videoId)}
        state={{ videoId: song.videoId }}
        className='flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
        <img
          src={song.thumbnailUrl}
          alt=''
          className='aspect-video h-11 shrink-0 rounded-lg object-cover'
        />
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-sm font-medium text-foreground'>
            {song.title}
          </span>
          <span className='truncate text-xs text-muted-foreground'>
            {song.author}
          </span>
        </span>
        <span className='grid size-11 shrink-0 place-items-center rounded-full text-foreground'>
          <PlayIcon className='size-5 fill-current' aria-hidden />
        </span>
      </Link>
      <button
        type='button'
        aria-label='Close Resume Bar'
        onClick={() => {
          setSong(null)
        }}
        className='grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
        <XIcon className='size-5' aria-hidden />
      </button>
    </div>
  )
}

// The installed app on a phone moves its navigation to the thumb: four tabs in a floating pill over the
// home indicator, with the resume bar above them. The website (and the app on a computer) keeps the top bar.
// While the page scrolls down the pill shrinks and drops its labels, and comes back on the way up (globals.css)
const TabBar = () => {
  const { pathname } = useLocation()
  const [song] = useAtom(resumeSongAtom)
  const shown = isInstalledPhone() && TAB_PAGES.test(pathname)
  const resume = shown && song !== null
  // The last tap on a tab whose page showed, for double taps
  const lastTap = useRef<{ to: string; at: number } | null>(null)

  useEffect(() => {
    const root = document.documentElement
    root.toggleAttribute('data-tabbar', shown)
    root.toggleAttribute('data-resume-bar', resume)
    return () => {
      delete root.dataset.tabbar
      delete root.dataset.resumeBar
    }
  }, [shown, resume])

  if (!shown) {
    return null
  }

  const onTabClick = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    const now = event.timeStamp
    const previous = lastTap.current
    const current = pathname === to
    lastTap.current = current ? { at: now, to } : null
    const scroller = pageScroller()
    const action = tabTap({
      atTop: (scroller?.scrollTop ?? 0) <= TOP_SLACK_PX,
      current,
      home: to === '/',
      sinceLastTapMs:
        previous?.to === to ? now - previous.at : Number.POSITIVE_INFINITY,
    })
    if (action === 'navigate') {
      return
    }
    event.preventDefault()
    if (action === 'update' && applyWaitingUpdate()) {
      return
    }
    scroller?.scrollTo({ behavior: scrollMotion(), top: 0 })
  }

  return (
    <div
      data-tabbar-root
      className='fixed inset-x-0 bottom-[calc(var(--safe-bottom)+0.5rem)] z-40 mx-auto flex w-[min(28rem,calc(100%-2rem))] flex-col gap-2'>
      <ResumeBar />
      <nav
        aria-label='App'
        data-tab-nav
        className='grid h-16 grid-cols-4 gap-1 rounded-full bg-popover/85 p-1 shadow-lg ring-1 ring-white/10 backdrop-blur-xl'>
        {TABS.map(({ to, label, icon: Icon, also }) => {
          const active = pathname === to || also?.test(pathname) === true
          return (
            <Link
              key={to}
              to={to}
              onClick={(event) => {
                onTabClick(event, to)
              }}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 rounded-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
                active
                  ? 'bg-primary-subtle text-primary-text'
                  : 'text-muted-foreground'
              )}>
              <Icon data-tab-icon className='size-6' aria-hidden />
              <span data-tab-label>{label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

export default TabBar
