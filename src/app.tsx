import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router'

import AppNotices from '@/components/shared/app-notices'
import { Toaster } from '@/components/ui/toaster'
import useKeyboardNavigation from '@/hooks/use-keyboard-navigation'

import LandingPage from './_root/pages/landing-page'
import RootLayout from './_root/root-layout'

import './globals.css'

// Dev-only: the static `import.meta.env.DEV` check drops the lab from production builds
const StageLabPage = import.meta.env.DEV
  ? lazy(async () => await import('./lab/stage-lab-page'))
  : null

// Only the landing page ships in the first bundle; the rest load on first visit, or earlier once the browser is idle
const pageImports = {
  about: async () => await import('./_root/pages/about-page'),
  player: async () => await import('./_root/pages/player-page'),
  search: async () => await import('./_root/pages/search-page'),
  versions: async () => await import('./_root/pages/versions-page'),
}
const AboutPage = lazy(pageImports.about)
const PlayerPage = lazy(pageImports.player)
const SearchPage = lazy(pageImports.search)
const VersionsPage = lazy(pageImports.versions)

const prefetchPages = () => {
  for (const load of Object.values(pageImports)) {
    void load()
  }
}

const App = () => {
  useKeyboardNavigation()

  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(prefetchPages, { timeout: 5000 })
      return () => {
        cancelIdleCallback(id)
      }
    }
    const id = setTimeout(prefetchPages, 2000)
    return () => {
      clearTimeout(id)
    }
  }, [])

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
          <Route
            path='/v/:videoId'
            element={
              <Suspense>
                <PlayerPage />
              </Suspense>
            }
          />
          <Route
            path='/v/:videoId/versions'
            element={
              <Suspense>
                <VersionsPage />
              </Suspense>
            }
          />
          <Route
            path='/about'
            element={
              <Suspense>
                <AboutPage />
              </Suspense>
            }
          />
          <Route
            path='/search'
            element={
              <Suspense>
                <SearchPage />
              </Suspense>
            }
          />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Route>
      </Routes>
      <AppNotices />
      <Toaster />
    </main>
  )
}

export default App
