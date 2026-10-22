import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { useLocation, useMatch } from 'react-router'

import { playerChromeOpenAtom, playerSurfaceAtom } from '@/context/atoms'
import { useArmed } from '@/hooks/use-armed'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/utils/cn'

import AppLogo from '../topbar/app-logo'
import GitHubButton from '../topbar/github-button'
import LyricsButton from '../topbar/lyrics-button'
import Notifications from '../topbar/notifications'
import ProfileButton from '../topbar/profile-button'
import SavedMenu from '../topbar/saved-menu'

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

// The bar's soft lower edge, in its own layer (topbar-fade): it shows with the bar over a scrolled page
const TopBarFade = ({
  player,
  mode,
}: {
  player: boolean
  mode: Bar['mode'] | 'top'
}) => (
  <div
    aria-hidden
    data-topbar-fade
    className={cn(
      'topbar-fade transition-opacity duration-300 ease-out motion-reduce:transition-none',
      (player || mode !== 'shown') && 'opacity-0'
    )}
  />
)

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
  // slides it away; scrolling up brings it back over a fade of the page color. Pages scroll in their own boxes,
  // so the outermost vertical scroller counts, and the box and path it happened on are kept so a new page, or
  // the same page remounted, starts clear
  const { pathname } = useLocation()
  const [bar, setBar] = useState<Bar | null>(null)
  useEffect(() => {
    const runs = new WeakMap<HTMLElement, Run>()
    const onScroll = (event: Event) => {
      const box = pageScroller(event.target)
      if (box === null) {
        return
      }
      const top = box.scrollTop
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
  // Rows that stick under the bar move up to the screen's top while it is away (--topbar-shown-h)
  const away = !isVideoPlayer && mode === 'hidden'
  useEffect(() => {
    document.documentElement.toggleAttribute('data-topbar-hidden', away)
  }, [away])
  const cluster = cn(
    'flex items-center gap-2 transition-fade-translate duration-300 ease-out sm:gap-3',
    isVideoPlayer && armed && 'pointer-events-auto',
    !iconsShown && '-translate-y-2 opacity-0'
  )
  // The buttons share one rhythm on a phone: equal cells, 48 px while there is room and down to the
  // buttons' own 40 px when there is not. Notifications stays while songs generate, when the others hide with
  // the player's floating UI, and in the installed app, whose tabs carry the rest
  const buttons = cn(
    'mr-1 ml-auto grid auto-cols-[minmax(2.5rem,3rem)] grid-flow-col justify-items-center sm:mr-2 sm:flex sm:items-center sm:gap-3',
    'tabbar:*:not-data-notifications:hidden',
    isVideoPlayer && armed && 'pointer-events-auto',
    '*:not-data-busy:transition-fade-translate *:not-data-busy:duration-300 *:not-data-busy:ease-out',
    !iconsShown && '*:not-data-busy:-translate-y-2 *:not-data-busy:opacity-0'
  )

  return (
    <>
      <header
        data-topbar
        className={cn(
          'fixed top-0 right-0 left-0 z-50 pt-safe-top pr-(--safe-right) pl-(--safe-left)',
          isVideoPlayer
            ? 'pointer-events-none'
            : 'transition-transform duration-300 ease-out motion-reduce:transition-none',
          !isVideoPlayer && mode !== 'top' && 'topbar-frost',
          // Keyboard focus inside a hidden bar brings it back
          !isVideoPlayer &&
            mode === 'hidden' &&
            '-translate-y-full focus-within:translate-y-0'
        )}>
        <nav className='flex-between h-14 w-full pr-2 pl-4 sm:px-4'>
          {/* The logo is the way home on every page, the player included */}
          {isVideoPlayer ? (
            <div data-player-chrome className={cluster}>
              <AppLogo />
            </div>
          ) : (
            <AppLogo />
          )}
          <div data-player-chrome className={buttons}>
            <Notifications />
            <LyricsButton />
            <SavedMenu />
            {!isVideoPlayer && (
              <>
                <span className='max-sm:hidden'>
                  <GitHubButton />
                </span>
                <ProfileButton />
              </>
            )}
          </div>
        </nav>
      </header>
      <TopBarFade player={isVideoPlayer} mode={mode} />
    </>
  )
}

export default TopBar
