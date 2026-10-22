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
    <div className='z-20 flex w-24 min-w-24 cursor-pointer justify-start min-[360px]:w-28 min-[360px]:min-w-28 sm:w-44 sm:min-w-44'>
      {/* The picture is taller than the bar and hangs over its edges; only the bar's own height takes a press,
          so a row stuck under the bar (the Gallery title) keeps its own */}
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
