import { useAtomValue } from 'jotai'
import { useLocation } from 'react-router'

import { playerChromeOpenAtom } from '@/context/atoms'
import { cn } from '@/utils/cn'

import AppLogo from '../topbar/AppLogo'
import FavouritesDropdownButton from '../topbar/FavouritesDropdownButton'
import HistoryDropdownButton from '../topbar/HistoryDropdownButton'
import ProfileButton from '../topbar/ProfileButton'

const TopBar = () => {
  const location = useLocation()
  const isVideoPlayer = location.pathname.includes('/v/')
  // On the player the icons hide and show with the player rail
  const chromeOpen = useAtomValue(playerChromeOpenAtom)
  const iconsShown = !isVideoPlayer || chromeOpen

  return (
    <section
      className={cn(
        'fixed top-0 right-0 left-0 z-50',
        isVideoPlayer && 'pointer-events-none'
      )}>
      <nav
        className={cn(
          'flex-between h-14 w-full sm:px-4',
          isVideoPlayer ? 'bg-secondary/0' : 'bg-muted/80'
        )}>
        {!isVideoPlayer && <AppLogo />}
        <div
          data-player-chrome='top'
          className={cn(
            'mr-2 ml-auto flex items-center gap-3 transition-[opacity,translate] duration-300 ease-out',
            isVideoPlayer && iconsShown && 'pointer-events-auto',
            !iconsShown && '-translate-y-2 opacity-0'
          )}>
          <FavouritesDropdownButton buttonVisibility={true} />
          <HistoryDropdownButton buttonVisibility={true} />
          {!isVideoPlayer && <ProfileButton />}
        </div>
      </nav>
    </section>
  )
}

export default TopBar
