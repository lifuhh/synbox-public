import { Navigate, Route, Routes } from 'react-router'

import { Toaster } from '@/components/ui/toaster'
import useKeyboardNavigation from '@/hooks/useKeyboardNavigation'

import { AboutPage, LandingPage, PlayerPage } from './_root/pages'
import RootLayout from './_root/RootLayout'

import './globals.css'

const App = () => {
  useKeyboardNavigation()

  return (
    <main className='flex h-screen bg-background'>
      <Routes>
        <Route element={<RootLayout />}>
          <Route index element={<LandingPage />} />
          <Route path='/v/:videoId' element={<PlayerPage />} />
          <Route path='/about' element={<AboutPage />} />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Route>
      </Routes>
      <Toaster />
    </main>
  )
}

export default App
