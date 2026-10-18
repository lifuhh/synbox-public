import React from 'react'
import { Outlet } from 'react-router'

import TopBar from '@/components/shared/TopBar'
import { useAppContext } from '@/context/AppContext'

const RootLayout: React.FC = () => {
  const { playerControlsVisible } = useAppContext()
  const shouldHideCursor = !playerControlsVisible

  return (
    <div className='relative min-h-screen w-full'>
      <div className='fixed inset-0 isolate overflow-hidden'>
        <div
          aria-hidden='true'
          className='pointer-events-none absolute -left-40 -z-10 transform-gpu overflow-hidden blur-3xl'>
          <div
            style={{
              clipPath:
                'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
            }}
            className='relative aspect-1155/678 w-160 rotate-40 bg-linear-to-tr from-[#CA195F] to-[#a81c95] opacity-60'
          />
        </div>
        <div
          aria-hidden='true'
          className='pointer-events-none absolute right-10 -bottom-40 -z-10 transform-gpu overflow-hidden blur-3xl'>
          <div
            style={{
              clipPath:
                'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
            }}
            className='relative aspect-1155/678 w-280 rotate-[-50deg] bg-linear-to-tr from-[#eb6fce] to-[#f785b3] opacity-95'
          />
        </div>
      </div>

      <div
        className={`relative h-screen w-full ${shouldHideCursor ? 'cursor-none' : ''} bg-muted/20`}>
        <TopBar />
        <section className='flex h-full flex-1 bg-[#150406]/75'>
          <Outlet />
        </section>
      </div>
    </div>
  )
}

export default RootLayout
