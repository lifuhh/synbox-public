import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import LoadError from '@/components/shared/load-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetLandingPagePlaylist } from '@/lib/react-query/queries-and-mutations'
import type { formattedYoutubeVideoItemForCarousel } from '@/types'

const SKELETON_CARDS = 4

// At the start, at the end -> the edges with more cards past them
const MORE: Record<string, 'none' | 'right' | 'left' | 'both'> = {
  'false-false': 'both',
  'false-true': 'left',
  'true-false': 'right',
  'true-true': 'none',
}

const SongCard = ({
  item,
  index,
}: {
  item: formattedYoutubeVideoItemForCarousel
  index: number
}) => (
  <Link
    to={`/v/${item.videoId}`}
    state={{ videoId: item.videoId }}
    title={item.title}
    className='group flex min-w-0 snap-start flex-col gap-1 rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
    <span className='relative mb-2 aspect-video overflow-hidden rounded-xl bg-thumbnail-placeholder'>
      <img
        src={item.thumbnailUrl}
        alt=''
        width='480'
        height='270'
        loading={index < SKELETON_CARDS ? 'eager' : 'lazy'}
        fetchPriority={index === 0 ? 'high' : 'auto'}
        className='unselectable size-full object-cover transition-transform duration-500 group-hover:scale-104 motion-reduce:transition-none'
      />
      <span className='absolute right-2.5 bottom-2.5 grid size-10 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'>
        <PlayIcon className='size-4 fill-current' aria-hidden />
      </span>
    </span>
    <span className='line-clamp-2 text-label leading-snug font-semibold text-foreground'>
      {item.title}
    </span>
    <span className='truncate text-sm text-muted-foreground'>
      {item.channel}
    </span>
  </Link>
)

const CardSkeleton = () => (
  <div className='flex min-w-0 flex-col gap-2'>
    <Skeleton className='aspect-video w-full' />
    <Skeleton className='h-4 w-4/5' />
    <Skeleton className='h-4 w-1/3' />
  </div>
)

// A native scroll row with snap points: trackpads, touch, Shift+wheel and the arrow keys (once the row has
// focus) all scroll it. The row's own width picks how many cards show (carousel-track), so the gap between
// cards is the same on every screen
const SongHighlightCarousel = () => {
  const {
    data: playlistData,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useGetLandingPagePlaylist()
  // State, not a ref: the row only exists once the playlist has loaded, and the effect below needs it
  const [track, setTrack] = useState<HTMLDivElement | null>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const updateEdges = useCallback(() => {
    if (!track) {
      return
    }
    setAtStart(track.scrollLeft <= 1)
    setAtEnd(track.scrollLeft >= track.scrollWidth - track.clientWidth - 1)
  }, [track])

  useEffect(() => {
    const observe = (row: HTMLDivElement) => {
      const observer = new ResizeObserver(updateEdges)
      observer.observe(row)
      return () => {
        observer.disconnect()
      }
    }
    return track ? observe(track) : undefined
  }, [track, updateEdges])

  const page = (direction: 1 | -1) => () => {
    if (!track) {
      return
    }
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    track.scrollBy({
      behavior: smooth ? 'smooth' : 'auto',
      left: direction * track.clientWidth * 0.9,
    })
  }

  const loading = isLoading || !playlistData
  // Which edges have more cards past them; those edges fade instead of cutting a card off
  const more = MORE[`${atStart}-${atEnd}`]

  return (
    <section
      aria-label='Recommendations'
      className='@container flex min-w-0 flex-1 flex-col gap-3'>
      <div className='flex items-center justify-between px-4 md:px-0'>
        <h2 className='text-xl font-semibold tracking-tight text-foreground'>
          Recommendations
        </h2>
        {!isError && (
          <div className='flex gap-2 touch:hidden'>
            <Button
              variant='outline'
              size='icon-round'
              aria-label='Previous Recommendations'
              disabled={loading || atStart}
              onClick={page(-1)}>
              <ChevronLeftIcon className='size-5' />
            </Button>
            <Button
              variant='outline'
              size='icon-round'
              aria-label='Next Recommendations'
              disabled={loading || atEnd}
              onClick={page(1)}>
              <ChevronRightIcon className='size-5' />
            </Button>
          </div>
        )}
      </div>
      {isError && (
        <LoadError
          message="Couldn't load the recommendations."
          retrying={isFetching}
          onRetry={() => {
            void refetch()
          }}
          className='mx-4 aspect-video rounded-xl bg-card md:mx-0 md:aspect-auto md:h-60'
        />
      )}
      {!isError && loading && (
        <output
          aria-label='Loading recommendations'
          data-more='right'
          className='carousel-track'>
          {Array.from({ length: SKELETON_CARDS }, (_, index) => (
            // oxlint-disable-next-line no-array-index-key
            <CardSkeleton key={index} />
          ))}
        </output>
      )}
      {!isError && !loading && (
        <div
          ref={setTrack}
          // oxlint-disable-next-line no-noninteractive-tabindex -- a scrolling region must be focusable so the arrow keys can scroll it
          tabIndex={0}
          onScroll={updateEdges}
          data-more={more}
          className='carousel-track rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
          {playlistData.map((item, index) => (
            <SongCard key={item.videoId} item={item} index={index} />
          ))}
        </div>
      )}
    </section>
  )
}

export default SongHighlightCarousel
