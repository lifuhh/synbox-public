import { useAtomValue } from 'jotai'
import { HouseIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { playerChromeOpenAtom } from '@/context/atoms'
import { cn } from '@/utils/cn'

import AppLogo from '../topbar/AppLogo'
import FavouritesDropdownButton from '../topbar/FavouritesDropdownButton'
import HistoryDropdownButton from '../topbar/HistoryDropdownButton'
import ProfileButton from '../topbar/ProfileButton'

const HomeButton = () => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant='outline'
          size='icon'
          className='border-primary/80 invisible-ring hover:border-white'>
          <Link to='/' aria-label='Return to Home Page'>
            <HouseIcon className='size-6 shrink-0' />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent className='border-none bg-accent unhighlightable'>
        Return to Home Page
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)

const TopBar = () => {
  const location = useLocation()
  const isVideoPlayer = location.pathname.includes('/v/')
  // On the player the buttons show and hide with the rest of its floating UI
  const chromeOpen = useAtomValue(playerChromeOpenAtom)
  const iconsShown = !isVideoPlayer || chromeOpen
  const cluster = cn(
    'flex items-center gap-3 transition-[opacity,translate] duration-300 ease-out',
    isVideoPlayer && iconsShown && 'pointer-events-auto',
    !iconsShown && '-translate-y-2 opacity-0'
  )

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
        {isVideoPlayer ? (
          <div data-player-chrome className={cn(cluster, 'ml-2')}>
            <HomeButton />
          </div>
        ) : (
          <AppLogo />
        )}
        <div data-player-chrome className={cn(cluster, 'mr-2 ml-auto')}>
          <FavouritesDropdownButton buttonVisibility={true} />
          <HistoryDropdownButton buttonVisibility={true} />
          {!isVideoPlayer && <ProfileButton />}
        </div>
      </nav>
    </section>
  )
}

export default TopBar
