import { useAtom } from 'jotai'
import {
  CircleUserRoundIcon,
  HouseIcon,
  LibraryBigIcon,
  SearchIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ComponentType, MouseEvent } from 'react'
import { Link, useLocation } from 'react-router'

import { requestPageRefresh } from '@/lib/home-refresh'
import { resumeSongAtom } from '@/lib/listening/store'
import { applyWaitingUpdate, isInstalledPhone } from '@/lib/pwa'
import { scrollMotion } from '@/lib/reduced-motion'
import { tabTap } from '@/lib/tab-tap'
import { cn } from '@/utils/cn'

// The mini player's code, fetched once a song plays in the installed app, while the player still shows: leaving
// the player hands the song to the bar in the same commit, or the song stops, so the bar can't wait to load then
let loadedMiniBar: ComponentType | null = null
// Null when the part didn't load: a deploy that replaced it makes the app reload (src/lib/pwa.ts › vite:preloadError),
// and the import then settles with nothing
const loadMiniBar = async (): Promise<ComponentType | null> => {
  const loaded = await import('./mini-bar').catch(() => null)
  const miniBar = loaded?.default ?? null
  loadedMiniBar = miniBar
  return miniBar
}
const useMiniBar = (wanted: boolean) => {
  const [miniBar, setMiniBar] = useState(() => loadedMiniBar)
  useEffect(() => {
    if (!wanted || miniBar !== null) {
      return
    }
    const load = async () => {
      const loaded = await loadMiniBar()
      if (loaded !== null) {
        setMiniBar(() => loaded)
      }
    }
    void load()
  }, [wanted, miniBar])
  return miniBar
}

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
// The tabs whose page refreshes on a tap at its top (page-refresh.tsx)
const REFRESHING_TABS = new Set(['/', '/library'])

// The tabs and the mini bar above them float over the home indicator, 0.5rem in from the screen's sides as Spotify's bar
export const DOCK =
  'fixed inset-x-0 bottom-[calc(var(--safe-bottom)+0.5rem)] z-40 mx-auto flex w-[min(28rem,calc(100%-1rem))] flex-col gap-2'

export const TabNav = ({
  pathname,
  onTabClick,
}: {
  pathname: string
  onTabClick?: (event: MouseEvent<HTMLAnchorElement>, to: string) => void
}) => (
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
            onTabClick?.(event, to)
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
)

// The tab page shown last and its place in the history (React Router's `idx`), which minimising the player goes back to
let lastTab: { path: string; idx: number } | null = null
export const returnTab = () => lastTab
export const historyIdx = () => {
  const state: unknown = window.history.state
  return typeof state === 'object' &&
    state !== null &&
    'idx' in state &&
    typeof state.idx === 'number'
    ? state.idx
    : 0
}

// The installed app on a phone moves its navigation to the thumb: four tabs in a floating pill over the
// home indicator, with the mini player above them. The website (and the app on a computer) keeps the top bar.
// While the page scrolls down the pill shrinks and drops its labels, and comes back on the way up (globals.css)
const TabBar = () => {
  const { pathname } = useLocation()
  const [song] = useAtom(resumeSongAtom)
  const shown = isInstalledPhone() && TAB_PAGES.test(pathname)
  const resume = shown && song !== null
  const MiniBar = useMiniBar(isInstalledPhone() && song !== null)
  // The last tap on a tab whose page showed, for double taps
  const lastTap = useRef<{ to: string; at: number } | null>(null)

  useEffect(() => {
    if (shown) {
      lastTab = { idx: historyIdx(), path: pathname }
    }
  }, [shown, pathname])

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
    const atTop = (scroller?.scrollTop ?? 0) <= TOP_SLACK_PX
    const action = tabTap({
      atTop,
      current,
      home: to === '/',
      refreshes: REFRESHING_TABS.has(to),
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
    // Nothing to swap in: the page already at its top refreshes instead (page-refresh.tsx)
    if (
      (action === 'update' || action === 'refresh') &&
      atTop &&
      requestPageRefresh(to)
    ) {
      return
    }
    scroller?.scrollTo({ behavior: scrollMotion(), top: 0 })
  }

  return (
    <div data-tabbar-root className={DOCK}>
      {/* oxlint-disable-next-line react/static-components -- mini-bar.tsx's default export, loaded once, never made here */}
      {MiniBar !== null && <MiniBar />}
      <TabNav pathname={pathname} onTabClick={onTabClick} />
    </div>
  )
}

export default TabBar
