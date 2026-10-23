import React from 'react'
import { Link, useLocation } from 'react-router'

import { topTap } from '@/lib/top-tap'

import { SynboxLogo } from '../svgicons'

const AppLogo: React.FC = () => {
  const location = useLocation()

  const handleOnClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const isModifiedClick =
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    if (isModifiedClick || location.pathname !== '/') {
      return
    }

    // Home already: back to its top, or a fresh page once there, as a tap on the bar does
    event.preventDefault()
    topTap()
  }

  return (
    // Its drawing starts as far in from the left as the buttons end from the right, as YouTube's does
    <div className='z-20 flex shrink-0 cursor-pointer justify-start sm:ml-2'>
      <Link
        to='/'
        onClick={handleOnClick}
        aria-label='Synbox home'
        className='flex h-14 items-center'>
        <span className='pointer-events-none inline-block'>
          <SynboxLogo />
        </span>
      </Link>
    </div>
  )
}

export default AppLogo
