import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import HeroGenerateLyricsSection from '@/components/generate-lyrics/hero-generate-lyrics-section'
import { HomeRefresh } from '@/components/landing-page/home-refresh'
import LandingPageCharts from '@/components/landing-page/popular-songs-table'
import SongGallery from '@/components/landing-page/song-gallery'
import SongHighlightCarousel from '@/components/landing-page/song-highlight-carousel'
import { BoxScrollbar } from '@/components/shared/doc-scroll'

const FOOT_LINK =
  'inline-flex min-h-6 items-center py-1 transition-colors hover:text-foreground'

// The page's foot: what Synbox is and its policies, one quiet row (Google's app verification wants the privacy
// policy linked from the home page), clear of the tab bar and mini player in the installed app
const HomeFoot = () => (
  <nav
    aria-label='About Synbox'
    className='mx-auto flex flex-wrap items-center justify-center gap-x-5 pb-page-bottom text-sm text-muted-foreground'>
    <Link to='/about' className={FOOT_LINK}>
      About
    </Link>
    <Link to='/privacy' className={FOOT_LINK}>
      Privacy
    </Link>
    <Link to='/terms' className={FOOT_LINK}>
      Terms
    </Link>
  </nav>
)

// The page rises in once per page load, top to bottom: each block marked `in-data-rise:rise-in` takes its turn
// by its own rise-delay, skeletons included. Coming back home later shows it at once
let pageShown = false

const LandingPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const rise = useMemo(() => !pageShown, [])
  useEffect(() => {
    pageShown = true
  }, [])

  return (
    <section
      ref={setBox}
      data-scroll-top
      data-home-page
      data-rise={rise || undefined}
      className='flex flex-1 flex-col overflow-x-hidden overflow-y-scroll page-x-md'>
      <title>Synbox</title>
      <HeroGenerateLyricsSection />
      <section className='mx-auto flex w-full flex-col gap-8 lg:flex-row lg:gap-6'>
        <SongHighlightCarousel />
        <LandingPageCharts />
      </section>
      <SongGallery />
      <HomeFoot />
      <BoxScrollbar box={box} />
      <HomeRefresh page={box} />
    </section>
  )
}

export default LandingPage
