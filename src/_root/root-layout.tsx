import React from 'react'
import { Outlet } from 'react-router'

import GenerationHost from '@/components/generation/generation-host'
import TopBar from '@/components/shared/top-bar'

const RootLayout: React.FC = () => (
  <div className='relative min-h-dvh w-full'>
    <div
      aria-hidden='true'
      className='pointer-events-none fixed inset-0 -z-10 page-glow'
    />

    <div className='relative h-dvh w-full'>
      <TopBar />
      <section className='flex h-full flex-1'>
        <Outlet />
      </section>
      <div data-generation-host>
        <GenerationHost />
      </div>
    </div>
  </div>
)

export default RootLayout
