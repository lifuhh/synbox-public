import React from 'react'
import { Link, useLocation } from 'react-router'

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

    event.preventDefault()
    document
      .querySelector<HTMLElement>('[data-scroll-top]')
      ?.scrollTo({ behavior: 'smooth', top: 0 })
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
