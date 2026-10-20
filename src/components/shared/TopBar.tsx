import { useAtomValue } from 'jotai'
import { useMatch } from 'react-router'

import { playerChromeOpenAtom } from '@/context/atoms'
import { useArmed } from '@/hooks/useArmed'
import { cn } from '@/utils/cn'

import AppLogo from '../topbar/AppLogo'
import FavouritesDropdownButton from '../topbar/FavouritesDropdownButton'
import HistoryDropdownButton from '../topbar/HistoryDropdownButton'
import ProfileButton from '../topbar/ProfileButton'
import UpdateButton from '../topbar/UpdateButton'

const TopBar = () => {
  // The versions page under /v/:id is an ordinary page with an opaque bar
  const isVideoPlayer = useMatch('/v/:videoId') !== null
  // On the player the buttons show and hide with the rest of its floating UI
  const chromeOpen = useAtomValue(playerChromeOpenAtom)
  const iconsShown = !isVideoPlayer || chromeOpen
  const armed = useArmed(iconsShown)
  const cluster = cn(
    'flex items-center gap-2 transition-[opacity,translate] duration-300 ease-out sm:gap-3',
    isVideoPlayer && armed && 'pointer-events-auto',
    !iconsShown && '-translate-y-2 opacity-0'
  )

  return (
    <section
      data-topbar
      className={cn(
        'fixed top-0 right-0 left-0 z-50 pt-[env(safe-area-inset-top)] pr-(--safe-right) pl-(--safe-left)',
        isVideoPlayer ? 'pointer-events-none' : 'bg-muted/80 backdrop-blur-md'
      )}>
      {/* The logo is taller than the bar and centred on it, so its waveform would start at the very
          top; with no bar behind it on the player, the row sits lower so the logo clears the edge */}
      <nav
        className={cn('flex-between h-14 w-full sm:px-4', isVideoPlayer && 'mt-2')}>
        {/* The logo is the way home on every page, the player included */}
        {isVideoPlayer ? (
          <div data-player-chrome className={cluster}>
            <AppLogo />
          </div>
        ) : (
          <AppLogo />
        )}
        <div data-player-chrome className={cn(cluster, 'mr-2 ml-auto')}>
          <UpdateButton />
          <FavouritesDropdownButton buttonVisibility={true} />
          <HistoryDropdownButton buttonVisibility={true} />
          {!isVideoPlayer && <ProfileButton />}
        </div>
      </nav>
    </section>
  )
}

export default TopBar
