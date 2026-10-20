import { Link } from 'react-router'

import { Skeleton } from '@/components/ui/skeleton'
import type { GallerySong } from '@/lib/appwrite/api'
import { useGetGallerySongs } from '@/lib/react-query/queries-and-mutations'

import HomeFooter from '../shared/home-footer'
import { Spotlight } from '../ui/spotlight'

// A plain grid in the page's own scroll: every song is one cheap card, images load as they near the
// screen, and cards far off screen skip layout and paint until they are scrolled to
const GRID =
  'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
const CARD =
  'block rounded-xl border bg-muted p-4 [contain-intrinsic-size:auto_320px] [content-visibility:auto]'

const SongCard = ({ song }: { song: GallerySong }) => (
  <Link
    to={`/v/${song.videoId}`}
    state={{ videoId: song.videoId }}
    className={`${CARD} transition-colors duration-300 hover:border-ring hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden`}>
    <p className='truncate text-lg font-bold tracking-wide text-zinc-100'>
      {song.title}
    </p>
    <p className='mb-3 truncate text-sm text-muted-foreground'>{song.author}</p>
    <img
      src={song.thumbnailUrl}
      alt=''
      loading='lazy'
      decoding='async'
      className='aspect-video w-full rounded-lg object-cover'
    />
  </Link>
)

// A first screen's worth at every column count
const SKELETON_CARDS = 8

const SongGallery = () => {
  const { data: songs, isLoading } = useGetGallerySongs()

  return (
    <section className='relative px-4 sm:px-8'>
      <Spotlight
        className='-top-80 left-40 scale-x-[-1] md:top-20 md:-left-40'
        fill='#580a24'
      />
      {isLoading ? (
        <output aria-label='Loading gallery' className={`${GRID} py-4`}>
          {Array.from({ length: SKELETON_CARDS }, (_, index) => (
            // oxlint-disable-next-line no-array-index-key
            <div key={index} className={CARD}>
              <Skeleton className='mb-2 h-7 w-3/4' />
              <Skeleton className='mb-3 h-5 w-1/3' />
              <Skeleton className='aspect-video w-full rounded-lg' />
            </div>
          ))}
        </output>
      ) : (
        <ul className={`${GRID} py-4`}>
          {songs?.map((song) => (
            <li key={song.videoId}>
              <SongCard song={song} />
            </li>
          ))}
        </ul>
      )}
      <HomeFooter />
    </section>
  )
}

export default SongGallery
