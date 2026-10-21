import HeroGenerateLyricsSection from '@/components/generate-lyrics/hero-generate-lyrics-section'
import LandingPageCharts from '@/components/landing-page/popular-songs-table'
import SongGallery from '@/components/landing-page/song-gallery'
import SongHighlightCarousel from '@/components/landing-page/song-highlight-carousel'

const LandingPage = () => (
  <section
    data-scroll-top
    className='flex custom-scrollbar flex-1 flex-col overflow-x-hidden overflow-y-scroll md:px-10'>
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

export default LandingPage
