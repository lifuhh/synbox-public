import HeroGenerateLyricsSection from '@/components/generate-lyrics/hero-generate-lyrics-section'
import LandingPageCharts from '@/components/landing-page/popular-songs-table'
import SongGallery from '@/components/landing-page/song-gallery'
import SongHighlightCarousel from '@/components/landing-page/song-highlight-carousel'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/utils/cn'

const SectionDivider = ({
  label,
  className,
}: {
  label: React.ReactNode
  className?: string
}) => (
  <div className={cn('flex items-center whitespace-nowrap', className)}>
    <Separator className='flex-1 bg-[#424242]' />
    <span className='mx-2.5'>{label}</span>
    <Separator className='flex-1 bg-[#424242]' />
  </div>
)

const LandingPage = () => (
  <section className='anchor-for-top-scroll flex custom-scrollbar flex-1 flex-col overflow-x-hidden overflow-y-scroll md:px-10'>
    <title>Synbox</title>
    <meta name='Synbox Homepage' content='Synbox - AI Powered Karaoke' />
    <HeroGenerateLyricsSection />
    <SectionDivider
      label={
        <h1 className='unselectable font_noto_sans_jp_black_900 text-2xl font-bold text-foreground'>
          Recommendations
        </h1>
      }
      className='my-3 px-8 pt-2 pb-6'
    />
    <section className='mx-auto flex w-full flex-col justify-center gap-4 lg:flex-row'>
      <SongHighlightCarousel />

      <LandingPageCharts />
    </section>
    <SectionDivider
      label={
        <h1 className='unselectable text-2xl font-bold text-foreground'>
          Gallery
        </h1>
      }
      className='my-2.5 px-8 py-2'
    />
    <SongGallery />
  </section>
)

export default LandingPage
