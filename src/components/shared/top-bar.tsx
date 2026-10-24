import { useAtomValue } from 'jotai'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useMatch } from 'react-router'

import { playerChromeOpenAtom, playerSurfaceAtom } from '@/context/atoms'
import { useArmed } from '@/hooks/use-armed'
import { useMediaQuery } from '@/hooks/use-media-query'
import { onEmptyBar, topTap } from '@/lib/top-tap'
import { cn } from '@/utils/cn'

import AppLogo from '../topbar/app-logo'
import LibraryMenu from '../topbar/library-menu'
import Notifications from '../topbar/notifications'
import ProfileButton from '../topbar/profile-button'
import { TopbarSearch } from '../topbar/topbar-search'

// Within this many pixels of the top a page counts as unscrolled
const TOP_SLACK_PX = 8
// How far the page must move one way before the bar follows, counted from where that direction began: a slow
// scroll adds up, while a resting finger or an inertia tail doesn't flicker the bar
const TRAVEL_PX = 24
// The bar only hides once the page has scrolled past its own height
const HIDE_AFTER_PX = 96

const scrolls = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1

// A list that scrolls inside a scrolling page (the charts) moves within the page, not the page itself. A page
// whose own box doesn't scroll (the lyrics list) leaves its inner list as the page's scroller
const insideScroller = (box: HTMLElement) => {
  for (let el = box.parentElement; el !== null; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if ((overflowY === 'auto' || overflowY === 'scroll') && scrolls(el)) {
      return true
    }
  }
  return false
}

// The page's own scroller that moved, or null for anything else that scrolled
const pageScroller = (target: EventTarget | null): HTMLElement | null => {
  // The wide watch page scrolls the document itself
  if (target === document) {
    return document.scrollingElement instanceof HTMLElement
      ? document.scrollingElement
      : null
  }
  // The narrow watch page's panels scroll under a video that doesn't move, so the bar stays
  if (document.documentElement.dataset.watch !== undefined) {
    return null
  }
  return target instanceof HTMLElement &&
    scrolls(target) &&
    !insideScroller(target)
    ? target
    : null
}

// One scroller's current run in one direction: where it began, where it is, and which way it goes
interface Run {
  from: number
  last: number
  dir: number
}

// Where the bar should go once the page reaches `top`, or null to leave it as it is
const turnAfter = (run: Run, top: number): 'shown' | 'hidden' | null => {
  const dir = Math.sign(top - run.last)
  if (dir !== 0 && dir !== run.dir) {
    run.from = run.last
    run.dir = dir
  }
  run.last = top
  const travelled = top - run.from
  if (travelled > TRAVEL_PX && top > HIDE_AFTER_PX) {
    return 'hidden'
  }
  if (travelled < -TRAVEL_PX) {
    return 'shown'
  }
  return null
}

interface Bar {
  box: HTMLElement
  path: string
  mode: 'shown' | 'hidden'
}

const nextBar = (
  current: Bar | null,
  scrolled: Omit<Bar, 'mode'>,
  turned: Bar['mode'] | null
): Bar => {
  const same =
    current !== null &&
    current.box === scrolled.box &&
    current.path === scrolled.path
  // Content scrolled under the bar never sits under a clear one: off the top it is at least shown
  const mode = turned ?? (same ? current.mode : 'shown')
  return same && current.mode === mode ? current : { ...scrolled, mode }
}

// The bar on the page at `pathname`: clear at the top of a page. A page left and come back to has a new box,
// back at its top, and the old one is gone
const modeOn = (bar: Bar | null, pathname: string): Bar['mode'] | 'top' =>
  bar !== null && bar.path === pathname && bar.box.isConnected
    ? bar.mode
    : 'top'

const TopBar = () => {
  // The versions page under /v/:id is an ordinary page with an opaque bar, and so is the watch page around a
  // player that is not the whole screen
  const onPlayer = useMatch('/v/:videoId') !== null
  const surface = useAtomValue(playerSurfaceAtom)
  const isVideoPlayer = onPlayer && surface !== 'watch'
  // On the player the buttons show and hide with the rest of its floating UI
  const chromeOpen = useAtomValue(playerChromeOpenAtom)
  const iconsShown = !isVideoPlayer || chromeOpen
  const armed = useArmed(iconsShown)

  // At the top of a page the bar is clear over the page glow, so the two read as one surface. Scrolling down
  // slides it away; scrolling up brings it back over the top scrim (root-layout.tsx), which paints the page's own
  // backdrop behind it. Pages scroll in their own boxes, so the outermost vertical scroller counts, and the box and
  // path it happened on are kept so a new page, or the same page remounted, starts clear
  const { pathname } = useLocation()
  const searchable =
    !isVideoPlayer && pathname !== '/' && pathname !== '/search'
  const [bar, setBar] = useState<Bar | null>(null)
  useEffect(() => {
    const runs = new WeakMap<HTMLElement, Run>()
    const onScroll = (event: Event) => {
      const box = pageScroller(event.target)
      if (box === null) {
        return
      }
      // iOS reports the rubber band past either end (below 0 at the top, past the end at the bottom). Read as
      // the end it springs back to, a bounce is no travel: the bar doesn't come back at the end of a list
      const top = Math.min(
        Math.max(box.scrollTop, 0),
        box.scrollHeight - box.clientHeight
      )
      const run = runs.get(box) ?? { dir: 0, from: top, last: top }
      runs.set(box, run)
      const turned = turnAfter(run, top)
      if (top <= TOP_SLACK_PX) {
        setBar(null)
        return
      }
      const path = globalThis.location.pathname
      setBar((current) => nextBar(current, { box, path }, turned))
    }
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [])
  // With a mouse the bar never slides away, as on YouTube: it costs a desktop little height, and its buttons
  // stay in reach without scrolling back up. Fingers keep the hide-on-scroll a phone needs the room for
  const pointerFine = useMediaQuery('(pointer: fine)')
  const scrolledMode = modeOn(bar, pathname)
  const mode = pointerFine && scrolledMode === 'hidden' ? 'shown' : scrolledMode
  // The state goes on <html> (data-topbar-state), where the bar's slide, a stuck row's slide and the top scrim all
  // read it, so the three start in the same frame. Set before paint, in the same frame as the bar's render
  const state = isVideoPlayer ? null : mode
  useLayoutEffect(() => {
    const root = document.documentElement
    if (state === null) {
      delete root.dataset.topbarState
    } else {
      root.dataset.topbarState = state
    }
  }, [state])
  // The bar's empty space takes a tap back to the page's top, or reloads a page already there: a pointer
  // shortcut, as on iOS (the keyboard has Home and the browser's reload). Listened to on the bar itself, so
  // presses in its menus, which sit outside it, never count
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const listen = (box: HTMLElement) => {
      const onClick = (event: MouseEvent) => {
        if (event.button === 0 && onEmptyBar(box, event.target)) {
          topTap()
        }
      }
      box.addEventListener('click', onClick)
      return () => {
        box.removeEventListener('click', onClick)
      }
    }
    return header.current === null || isVideoPlayer
      ? undefined
      : listen(header.current)
  }, [isVideoPlayer])
  const cluster = cn(
    'flex items-center gap-2 transition-fade-translate duration-300 ease-out sm:gap-3',
    isVideoPlayer && armed && 'pointer-events-auto',
    !iconsShown && '-translate-y-2 opacity-0 motion-reduce:translate-y-0'
  )
  // The buttons share one rhythm on a phone: equal cells, 48 px while there is room and down to the
  // buttons' own 40 px when there is not. Notifications stays while songs generate, when the others hide with
  // the player's floating UI, and in the installed app, whose tabs carry the rest
  const buttons = cn(
    'mr-1 ml-auto grid auto-cols-[minmax(2.5rem,3rem)] grid-flow-col justify-items-center sm:mr-2 sm:flex sm:items-center sm:gap-3',
    'tabbar:*:not-data-notifications:hidden',
    isVideoPlayer && armed && 'pointer-events-auto',
    '*:not-data-busy:transition-fade-translate *:not-data-busy:duration-300 *:not-data-busy:ease-out',
    !iconsShown &&
      '*:not-data-busy:-translate-y-2 *:not-data-busy:opacity-0 motion-reduce:*:not-data-busy:translate-y-0'
  )

  return (
    <header
      ref={header}
      data-topbar
      className={cn(
        'fixed top-0 right-0 left-0 z-50 pt-safe-top pr-(--safe-right) pl-(--safe-left)',
        // Slid away and faded by html[data-topbar-state='hidden'] (globals.css)
        isVideoPlayer
          ? 'pointer-events-none'
          : 'transition-transform duration-300 ease-out motion-reduce:transition-none'
      )}>
      <nav className='flex-between h-14 w-full pr-2 pl-4 transition-opacity duration-300 ease-out sm:px-4 lg:px-topbar-x'>
        {/* The logo is the way home on every page, the player included */}
        {isVideoPlayer ? (
          <div data-player-chrome className={cluster}>
            <AppLogo />
          </div>
        ) : (
          <AppLogo />
        )}
        {/* Search from any page but the two that have their own field (home and search) and the full-screen
            player: in the bar on a wide screen, behind a button on a phone */}
        {searchable && (
          // Centred on the page once the bar has room on both sides, as on YouTube; narrower, between the two
          <div className='hidden min-w-0 flex-1 justify-center md:flex xl:pointer-events-none xl:absolute xl:inset-x-0 xl:*:pointer-events-auto'>
            <TopbarSearch variant='inline' />
          </div>
        )}
        <div data-player-chrome className={buttons}>
          {searchable && (
            <span className='md:hidden'>
              <TopbarSearch variant='button' />
            </span>
          )}
          <Notifications />
          <LibraryMenu />
          {/* The owner's portfolio link goes here, with its own icon, once that site is up (the GitHub button
              sat here until the project went closed source) */}
          {!isVideoPlayer && <ProfileButton />}
        </div>
      </nav>
    </header>
  )
}

export default TopBar
