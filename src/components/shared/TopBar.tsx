import { useLocation } from 'react-router'

import AppLogo from '../topbar/AppLogo'
import FavouritesDropdownButton from '../topbar/FavouritesDropdownButton'
import HistoryDropdownButton from '../topbar/HistoryDropdownButton'
import ProfileButton from '../topbar/ProfileButton'

const TopBar = () => {
  const location = useLocation()
  const isVideoPlayer = location.pathname.includes('/v/')

  return (
    <section
      className={`fixed top-0 right-0 left-0 z-50 transition-opacity duration-300 ${isVideoPlayer ? 'pointer-events-none' : ''}`}>
      <nav
        className={`flex-between h-14 w-full ${isVideoPlayer ? 'bg-secondary/0' : 'bg-muted/80'} ${isVideoPlayer ? 'pointer-events-auto' : ''} sm:px-4`}>
        {!isVideoPlayer && <AppLogo />}
        <div
          className={`mr-2 ml-auto flex items-center gap-3 ${isVideoPlayer ? 'pointer-events-auto' : ''}`}>
          <FavouritesDropdownButton buttonVisibility={true} />
          <HistoryDropdownButton buttonVisibility={true} />
          {!isVideoPlayer && <ProfileButton />}
        </div>
      </nav>
    </section>
  )
}

export default TopBar
