import React from 'react'
import { Outlet } from 'react-router'

import GenerationHost from '@/components/generation/generation-host'
import TabBar from '@/components/shared/tab-bar'
import TopBar from '@/components/shared/top-bar'

const RootLayout: React.FC = () => (
  <div className='relative min-h-(--app-h) w-full'>
    <div
      aria-hidden='true'
      className='pointer-events-none fixed inset-0 -z-10 page-glow'
    />

    <div className='relative h-(--app-h) w-full doc-scroll:h-auto'>
      {/* The page's own backdrop (its color and the glow) behind the floating top: the status bar, the top
          bar over a scrolled page, a row stuck under it. Above the pages, under the top bar, a stuck row,
          menus, dialogs and the generation panel */}
      <div
        aria-hidden='true'
        data-status-scrim
        className='top-scrim fixed inset-x-0 top-0 z-40 bg-background page-glow'
      />
      <TopBar />
      <section
        data-page-content
        className='flex h-full flex-1 doc-scroll:h-auto'>
        <Outlet />
      </section>
      <TabBar />
      <div data-generation-host>
        <GenerationHost />
      </div>
    </div>
  </div>
)

export default RootLayout
