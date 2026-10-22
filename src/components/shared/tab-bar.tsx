import { useAtom } from 'jotai'
import {
  BookOpenTextIcon,
  CircleUserRoundIcon,
  HouseIcon,
  PlayIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Link, NavLink, useLocation } from 'react-router'

import { resumeSongAtom, songPath } from '@/lib/listening/store'
import { isInstalledPhone } from '@/lib/pwa'
import { cn } from '@/utils/cn'

// `also`: other pages the tab is the home of (playlists open from You)
const TABS: {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  also?: RegExp
}[] = [
  { end: true, icon: HouseIcon, label: 'Home', to: '/' },
  { icon: SearchIcon, label: 'Search', to: '/search' },
  { end: true, icon: BookOpenTextIcon, label: 'Lyrics', to: '/lyrics' },
  {
    also: /^\/playlists/u,
    icon: CircleUserRoundIcon,
    label: 'You',
    to: '/you',
  },
]

// The player, a song's reader and the admin pages own the whole screen; every other page gets the tabs
const TAB_PAGES = /^\/(?:search|lyrics|you|playlists(?:\/[^/]+)?|about)?$/u

// Back to the song opened last: its picture and title, a tap away from any tab
const ResumeBar = () => {
  const [song, setSong] = useAtom(resumeSongAtom)
  if (song === null) {
    return null
  }
  return (
    <div className='flex h-14 items-center gap-1 rounded-2xl bg-popover/90 p-1.5 shadow-lg ring-1 ring-white/10 backdrop-blur-xl'>
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
// home indicator, with the resume bar above them. The website (and the app on a computer) keeps the top bar
const TabBar = () => {
  const { pathname } = useLocation()
  const [song] = useAtom(resumeSongAtom)
  const shown = isInstalledPhone() && TAB_PAGES.test(pathname)
  const resume = shown && song !== null

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
  return (
    <div className='fixed inset-x-0 bottom-[calc(var(--safe-bottom)+0.5rem)] z-40 mx-auto flex w-[min(28rem,calc(100%-2rem))] flex-col gap-2'>
      <ResumeBar />
      <nav
        aria-label='App'
        className='grid h-16 grid-cols-4 gap-1 rounded-full bg-popover/85 p-1 shadow-lg ring-1 ring-white/10 backdrop-blur-xl'>
        {TABS.map(({ to, label, icon: Icon, end, also }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-current={also?.test(pathname) === true ? 'page' : undefined}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-0.5 rounded-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
                isActive || also?.test(pathname) === true
                  ? 'bg-primary-subtle text-primary-text'
                  : 'text-muted-foreground'
              )
            }>
            <Icon className='size-6' aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default TabBar
