import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'

import AppNotices from '@/components/shared/AppNotices'
import { Toaster } from '@/components/ui/toaster'
import useKeyboardNavigation from '@/hooks/useKeyboardNavigation'

import {
  AboutPage,
  LandingPage,
  PlayerPage,
  SearchPage,
  VersionsPage,
} from './_root/pages'
import RootLayout from './_root/RootLayout'

import './globals.css'

// Dev-only: the static `import.meta.env.DEV` check drops the lab from production builds
const StageLabPage = import.meta.env.DEV
  ? lazy(async () => await import('./lab/StageLabPage'))
  : null

const App = () => {
  useKeyboardNavigation()

  return (
    <main className='flex h-dvh bg-background'>
      <Routes>
        {StageLabPage && (
          <Route
            path='/lab/stage'
            element={
              <Suspense>
                <StageLabPage />
              </Suspense>
            }
          />
        )}
        <Route element={<RootLayout />}>
          <Route index element={<LandingPage />} />
          <Route path='/v/:videoId' element={<PlayerPage />} />
          <Route path='/v/:videoId/versions' element={<VersionsPage />} />
          <Route path='/about' element={<AboutPage />} />
          <Route path='/search' element={<SearchPage />} />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Route>
      </Routes>
      <AppNotices />
      <Toaster />
    </main>
  )
}

export default App
