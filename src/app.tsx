import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router'

import AppNotices from '@/components/shared/app-notices'
import { Toaster } from '@/components/ui/toaster'
import useKeyboardNavigation from '@/hooks/use-keyboard-navigation'
import { LibrarySync } from '@/lib/library/sync'
import { useOfflineSync } from '@/lib/offline/sync'
import { PrefsSync } from '@/lib/prefs/sync'

import LandingPage from './_root/pages/landing-page'
import RootLayout from './_root/root-layout'

import './globals.css'
// Registers the service worker, and swaps a new deploy in at the next page change
import '@/lib/pwa'
import '@/lib/selectable-links'

// Dev-only: the static `import.meta.env.DEV` check drops the lab from production builds
const StageLabPage = import.meta.env.DEV
  ? lazy(async () => await import('./lab/stage-lab-page'))
  : null

// Only the landing page ships in the first bundle; the rest load on first visit, or once the opening is over
const pageImports = {
  about: async () => await import('./_root/pages/about-page'),
  offline: async () => await import('./_root/pages/offline-page'),
  player: async () => await import('./_root/pages/player-page'),
  playlist: async () => await import('./_root/pages/playlist-page'),
  playlists: async () => await import('./_root/pages/playlists-page'),
  reader: async () => await import('./_root/pages/reader-page'),
  search: async () => await import('./_root/pages/search-page'),
  versions: async () => await import('./_root/pages/versions-page'),
  you: async () => await import('./_root/pages/you-page'),
}
const AboutPage = lazy(pageImports.about)
const OfflinePage = lazy(pageImports.offline)
const PlayerPage = lazy(pageImports.player)
const PlaylistPage = lazy(pageImports.playlist)
const PlaylistsPage = lazy(pageImports.playlists)
const YouPage = lazy(pageImports.you)
const ReaderPage = lazy(pageImports.reader)
const SearchPage = lazy(pageImports.search)
const VersionsPage = lazy(pageImports.versions)
// Not prefetched: only admins open it
const AdminPage = lazy(async () => await import('./_root/pages/admin-page'))

const PREFETCH_DELAY_MS = 4000

// The lyrics pages lived under /offline until they worked online too
const OldReaderLink = () => {
  const { videoId = '' } = useParams()
  return <Navigate to={`/lyrics/${videoId}`} replace />
}

const prefetchPages = () => {
  for (const load of Object.values(pageImports)) {
    void load()
  }
}

const App = () => {
  useKeyboardNavigation()
  // Keeps this device's offline lyrics in step with the user's songs, bookmarks and recent songs
  useOfflineSync()
  // After the first screen has loaded, so the prefetch never competes with it
  useEffect(() => {
    const id = setTimeout(prefetchPages, PREFETCH_DELAY_MS)
    return () => {
      clearTimeout(id)
    }
  }, [])

  return (
    <main className='flex h-(--app-h) watch-wide:h-auto'>
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
            path='/admin'
            element={
              <Suspense>
                <AdminPage />
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
          <Route path='/offline' element={<Navigate to='/lyrics' replace />} />
          <Route path='/offline/:videoId' element={<OldReaderLink />} />
          <Route
            path='/lyrics'
            element={
              <Suspense>
                <OfflinePage />
              </Suspense>
            }
          />
          <Route
            path='/lyrics/:videoId'
            element={
              <Suspense>
                <ReaderPage />
              </Suspense>
            }
          />
          <Route
            path='/playlists'
            element={
              <Suspense>
                <PlaylistsPage />
              </Suspense>
            }
          />
          <Route
            path='/playlists/:playlistId'
            element={
              <Suspense>
                <PlaylistPage />
              </Suspense>
            }
          />
          <Route
            path='/you'
            element={
              <Suspense>
                <YouPage />
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
      <LibrarySync />
      <PrefsSync />
      <Toaster />
    </main>
  )
}

export default App
