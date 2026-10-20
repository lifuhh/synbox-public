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
