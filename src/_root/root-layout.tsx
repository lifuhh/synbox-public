import React from 'react'
import { Outlet } from 'react-router'

import AccountDialogs from '@/components/account/account-dialogs'
import GenerationHost from '@/components/generation/generation-host'
import RouteArrival, { focusPage } from '@/components/shared/route-arrival'
import TabBar from '@/components/shared/tab-bar'
import TopBar from '@/components/shared/top-bar'

const RootLayout: React.FC = () => (
  <div className='relative min-h-(--app-h) w-full'>
    <div
      aria-hidden='true'
      data-page-glow
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
      {/* The first Tab stop: past the bars, straight to the page (WCAG 2.4.1). Seen only while focused, floating just
          under the top bar on the page's own left edge: in the bar's row it sat under the logo (WCAG 2.4.11). Hidden by
          sr-only only while unfocused, so focused it keeps its own padding and place (not-sr-only zeroes both) */}
      <button
        type='button'
        onClick={focusPage}
        className='fixed top-[calc(var(--topbar-h)+0.5rem+var(--notices-h,0px))] left-[calc(var(--safe-left)+1rem)] z-50 h-11 rounded-full bg-popover px-4 text-sm font-medium text-popover-foreground shadow-float not-focus-visible:sr-only md:left-[calc(var(--safe-left)+var(--page-gutter-wide))]'>
        Skip to Content
      </button>
      <TopBar />
      <RouteArrival />
      {/* Focus lands here on a page change (route-arrival.tsx); the box itself draws no ring, its controls do */}
      <section
        data-page-content
        tabIndex={-1}
        className='flex h-full flex-1 doc-scroll:h-auto'>
        <Outlet />
      </section>
      <TabBar />
      <div data-generation-host>
        <GenerationHost />
      </div>
      <AccountDialogs />
    </div>
  </div>
)

export default RootLayout
