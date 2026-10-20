import React from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { SynboxLogo } from '../svgicons'

const AppLogo: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()

  const handleOnClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (location.pathname === '/') {
      const landingPage =
        document.querySelector<HTMLElement>('[data-scroll-top]')
      if (landingPage !== null) {
        landingPage.scrollTo({ behavior: 'smooth', top: 0 })
      }
    } else {
      void navigate('/')
    }
  }

  return (
    <div className='z-20 flex w-36 min-w-36 cursor-pointer justify-start py-2 align-middle sm:w-44 sm:min-w-44'>
      <Link to='/' onClick={handleOnClick} aria-label='Synbox home'>
        <span className='inline-block'>
          <SynboxLogo />
        </span>
      </Link>
    </div>
  )
}

export default AppLogo
