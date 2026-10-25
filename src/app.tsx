import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router'

import AppNotices from '@/components/shared/app-notices'
import {
  ListPageSkeleton,
  PlayerSkeleton,
  TextPageSkeleton,
} from '@/components/shared/route-skeletons'
import { Toaster } from '@/components/ui/toaster'
import { LibrarySync } from '@/lib/library/sync'
import { OfflineSync } from '@/lib/offline/sync'
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
  library: async () => await import('./_root/pages/library-page'),
  player: async () => await import('./_root/pages/player-page'),
  playlist: async () => await import('./_root/pages/playlist-page'),
  playlists: async () => await import('./_root/pages/playlists-page'),
  privacy: async () => await import('./_root/pages/privacy-page'),
  reader: async () => await import('./_root/pages/reader-page'),
  search: async () => await import('./_root/pages/search-page'),
  terms: async () => await import('./_root/pages/terms-page'),
  versions: async () => await import('./_root/pages/versions-page'),
  you: async () => await import('./_root/pages/you-page'),
}
const AboutPage = lazy(pageImports.about)
const LibraryPage = lazy(pageImports.library)
const PlayerPage = lazy(pageImports.player)
const PrivacyPage = lazy(pageImports.privacy)
const PlaylistPage = lazy(pageImports.playlist)
const PlaylistsPage = lazy(pageImports.playlists)
const YouPage = lazy(pageImports.you)
const ReaderPage = lazy(pageImports.reader)
const SearchPage = lazy(pageImports.search)
const TermsPage = lazy(pageImports.terms)
const VersionsPage = lazy(pageImports.versions)
// Not prefetched: only admins open it
const AdminPage = lazy(async () => await import('./_root/pages/admin-page'))

const PREFETCH_DELAY_MS = 4000

// A page's code starts loading the moment a pointer rests on, a finger lands on, or the keyboard reaches a link to it,
// ahead of the click: the time between the two is often all the download needs. Each import loads once
const PAGE_OF_PATH: [RegExp, keyof typeof pageImports][] = [
  [/^\/v\/[^/]+\/versions/u, 'versions'],
  [/^\/v\//u, 'player'],
  [/^\/lyrics\//u, 'reader'],
  [/^\/search/u, 'search'],
  [/^\/library/u, 'library'],
  [/^\/you/u, 'you'],
  [/^\/about/u, 'about'],
  [/^\/privacy/u, 'privacy'],
  [/^\/terms/u, 'terms'],
  [/^\/playlists\/./u, 'playlist'],
  [/^\/playlists/u, 'playlists'],
]
const prefetchLinked = (event: Event) => {
  const link =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[href^="/"]')
      : null
  const path = link?.getAttribute('href') ?? ''
  const page = PAGE_OF_PATH.find(([pattern]) => pattern.test(path))?.[1]
  if (page !== undefined) {
    void pageImports[page]()
  }
}
const INTENT_EVENTS = ['pointerover', 'pointerdown', 'focusin'] as const

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
  // After the first screen has loaded, so the prefetch never competes with it
  useEffect(() => {
    const id = setTimeout(prefetchPages, PREFETCH_DELAY_MS)
    return () => {
      clearTimeout(id)
    }
  }, [])
  useEffect(() => {
    for (const type of INTENT_EVENTS) {
      document.addEventListener(type, prefetchLinked, { passive: true })
    }
    return () => {
      for (const type of INTENT_EVENTS) {
        document.removeEventListener(type, prefetchLinked)
      }
    }
  }, [])

  return (
    <main className='flex h-(--app-h) doc-scroll:h-auto doc-scroll:pr-(--doc-gutter)'>
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
              <Suspense fallback={<PlayerSkeleton />}>
                <PlayerPage />
              </Suspense>
            }
          />
          <Route
            path='/v/:videoId/versions'
            element={
              <Suspense fallback={<ListPageSkeleton docScroll />}>
                <VersionsPage />
              </Suspense>
            }
          />
          <Route
            path='/admin'
            element={
              <Suspense fallback={<ListPageSkeleton docScroll />}>
                <AdminPage />
              </Suspense>
            }
          />
          <Route
            path='/about'
            element={
              <Suspense fallback={<TextPageSkeleton docScroll />}>
                <AboutPage />
              </Suspense>
            }
          />
          <Route
            path='/privacy'
            element={
              <Suspense fallback={<TextPageSkeleton docScroll />}>
                <PrivacyPage />
              </Suspense>
            }
          />
          <Route
            path='/terms'
            element={
              <Suspense fallback={<TextPageSkeleton docScroll />}>
                <TermsPage />
              </Suspense>
            }
          />
          <Route path='/offline' element={<Navigate to='/library' replace />} />
          <Route path='/offline/:videoId' element={<OldReaderLink />} />
          {/* The saved lyrics' list was its own page until it became the Library */}
          <Route path='/lyrics' element={<Navigate to='/library' replace />} />
          <Route
            path='/library'
            element={
              <Suspense fallback={<ListPageSkeleton docScroll={false} />}>
                <LibraryPage />
              </Suspense>
            }
          />
          <Route
            path='/lyrics/:videoId'
            element={
              <Suspense fallback={<TextPageSkeleton docScroll={false} />}>
                <ReaderPage />
              </Suspense>
            }
          />
          <Route
            path='/playlists'
            element={
              <Suspense fallback={<ListPageSkeleton docScroll />}>
                <PlaylistsPage />
              </Suspense>
            }
          />
          <Route
            path='/playlists/:playlistId'
            element={
              <Suspense fallback={<ListPageSkeleton docScroll={false} />}>
                <PlaylistPage />
              </Suspense>
            }
          />
          <Route
            path='/you'
            element={
              <Suspense fallback={<ListPageSkeleton docScroll />}>
                <YouPage />
              </Suspense>
            }
          />
          <Route
            path='/search'
            element={
              <Suspense fallback={<ListPageSkeleton docScroll />}>
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
      {/* Keeps this device's offline lyrics in step with the user's songs, bookmarks and recent songs */}
      <OfflineSync />
      <Toaster />
    </main>
  )
}

export default App
