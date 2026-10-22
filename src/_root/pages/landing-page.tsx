import { useEffect, useMemo } from 'react'

import HeroGenerateLyricsSection from '@/components/generate-lyrics/hero-generate-lyrics-section'
import LandingPageCharts from '@/components/landing-page/popular-songs-table'
import SongGallery from '@/components/landing-page/song-gallery'
import SongHighlightCarousel from '@/components/landing-page/song-highlight-carousel'

// The page rises in once per page load, top to bottom: each block marked `in-data-rise:rise-in` takes its turn
// by its own rise-delay, skeletons included. Coming back home later shows it at once
let pageShown = false

const LandingPage = () => {
  const rise = useMemo(() => !pageShown, [])
  useEffect(() => {
    pageShown = true
  }, [])

  return (
    <section
      data-scroll-top
      data-rise={rise || undefined}
      className='flex custom-scrollbar flex-1 flex-col overflow-x-hidden overflow-y-scroll page-x-md'>
      <title>Synbox</title>
      <meta name='Synbox Homepage' content='Synbox - AI Powered Karaoke' />
      <HeroGenerateLyricsSection />
      <section className='mx-auto flex w-full flex-col gap-8 lg:flex-row lg:gap-6'>
        <SongHighlightCarousel />
        <LandingPageCharts />
      </section>
      <SongGallery />
    </section>
  )
}

export default LandingPage
