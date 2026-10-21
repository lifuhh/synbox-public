import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { useLocation, useMatch } from 'react-router'

import { setGenerationDock } from '@/components/generation/dock'
import { playerChromeOpenAtom, playerSurfaceAtom } from '@/context/atoms'
import { useArmed } from '@/hooks/use-armed'
import { cn } from '@/utils/cn'

import AppLogo from '../topbar/app-logo'
import GitHubButton from '../topbar/github-button'
import LyricsButton from '../topbar/lyrics-button'
import ProfileButton from '../topbar/profile-button'
import SavedMenu from '../topbar/saved-menu'

// Within this many pixels of the top a page counts as unscrolled
const TOP_SLACK_PX = 8
// Smaller moves are ignored, so a resting finger or an inertia tail doesn't flicker the bar
const JITTER_PX = 4
// The bar only hides once the page has scrolled past its own height
const HIDE_AFTER_PX = 96

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
  // so any vertical scroller counts, and the path it happened on is kept so a new page starts clear
  const { pathname } = useLocation()
  const [scrollState, setScrollState] = useState<{
    path: string
    mode: 'shown' | 'hidden'
  } | null>(null)
  useEffect(() => {
    const lastTop = new WeakMap<HTMLElement, number>()
    const onScroll = (event: Event) => {
      const box = event.target
      // The watch page's panels scroll inside a page that doesn't, so the bar stays
      if (document.documentElement.dataset.watch !== undefined) {
        return
      }
      if (
        !(box instanceof HTMLElement) ||
        box.scrollHeight <= box.clientHeight + 1
      ) {
        return
      }
      const top = box.scrollTop
      const previous = lastTop.get(box) ?? 0
      lastTop.set(box, top)
      if (top <= TOP_SLACK_PX) {
        setScrollState(null)
        return
      }
      if (Math.abs(top - previous) < JITTER_PX) {
        return
      }
      const path = globalThis.location.pathname
      const mode = top > previous && top > HIDE_AFTER_PX ? 'hidden' : 'shown'
      setScrollState((current) =>
        current?.path === path && current.mode === mode
          ? current
          : { mode, path }
      )
    }
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [])
  const mode = scrollState?.path === pathname ? scrollState.mode : 'top'
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
  // buttons' own 40 px when there is not, so a lyrics generation docked first in the row fits beside them.
  // It stays while the others hide with the player's floating UI
  const buttons = cn(
    'mr-1 ml-auto grid auto-cols-[minmax(2.5rem,3rem)] grid-flow-col justify-items-center sm:mr-2 sm:flex sm:items-center sm:gap-3',
    isVideoPlayer && armed && 'pointer-events-auto',
    '*:not-data-generation-dock:transition-fade-translate *:not-data-generation-dock:duration-300 *:not-data-generation-dock:ease-out',
    !iconsShown &&
      '*:not-data-generation-dock:-translate-y-2 *:not-data-generation-dock:opacity-0'
  )

  return (
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
      {/* The logo is taller than the bar and centred on it, so its waveform would start at the very
          top; with no bar behind it on the player, the row sits lower so the logo clears the edge */}
      <nav
        className={cn(
          'flex-between h-14 w-full pr-2 sm:px-4',
          isVideoPlayer && 'mt-2'
        )}>
        {/* The logo is the way home on every page, the player included */}
        {isVideoPlayer ? (
          <div data-player-chrome className={cluster}>
            <AppLogo />
          </div>
        ) : (
          <AppLogo />
        )}
        <div data-player-chrome className={buttons}>
          {/* A minimized lyrics generation on a phone (generation-host.tsx) */}
          <div
            ref={setGenerationDock}
            data-generation-dock
            className='contents'
          />
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
  )
}

export default TopBar
