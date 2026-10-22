import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { ListSong } from '@/lib/listening/model'
import { useArtistSongs, useRecentlyPlayed } from '@/lib/listening/shelves'
import { cn } from '@/utils/cn'

import { SongCard } from './song-card'

// Whether a row is scrolled to either end, so its arrows can say there is nothing more that way. Measured
// again on a scroll, a resize, and when its songs change
const useEnds = () => {
  const ref = useRef<HTMLUListElement>(null)
  const [ends, setEnds] = useState({ end: true, start: true })
  useEffect(() => {
    const row = ref.current
    const measure = () => {
      if (row !== null) {
        setEnds({
          end: row.scrollLeft + row.clientWidth >= row.scrollWidth - 1,
          start: row.scrollLeft <= 1,
        })
      }
    }
    const resized = new ResizeObserver(measure)
    const changed = new MutationObserver(measure)
    if (row !== null) {
      measure()
      resized.observe(row)
      changed.observe(row, { childList: true })
      row.addEventListener('scroll', measure, { passive: true })
    }
    return () => {
      resized.disconnect()
      changed.disconnect()
      row?.removeEventListener('scroll', measure)
    }
  }, [])
  return { ends, ref }
}

// One sideways row of song cards under a heading. Fingers swipe it; a mouse gets arrows beside the heading
const Shelf = ({ title, songs }: { title: string; songs: ListSong[] }) => {
  const id = useId()
  const { ends, ref } = useEnds()
  const page = (direction: -1 | 1) => {
    const row = ref.current
    if (row !== null) {
      row.scrollBy({ left: direction * row.clientWidth * 0.8 })
    }
  }
  return (
    <section aria-labelledby={id}>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <h2 id={id} className='min-w-0 truncate text-base font-semibold'>
          {title}
        </h2>
        <div
          className={cn(
            'hidden shrink-0 gap-2 pointer-fine:flex',
            ends.start && ends.end && 'pointer-fine:hidden'
          )}>
          <Button
            variant='outline'
            size='icon-round'
            aria-label={`Scroll ${title} Back`}
            disabled={ends.start}
            onClick={() => {
              page(-1)
            }}>
            <ChevronLeftIcon className='size-5' />
          </Button>
          <Button
            variant='outline'
            size='icon-round'
            aria-label={`Scroll ${title} Forward`}
            disabled={ends.end}
            onClick={() => {
              page(1)
            }}>
            <ChevronRightIcon className='size-5' />
          </Button>
        </div>
      </div>
      <ul
        ref={ref}
        className='-mx-1 no-scrollbar flex snap-x snap-mandatory scroll-px-1 gap-4 overflow-x-auto overscroll-x-contain px-1 py-1'>
        {songs.map((song) => (
          <SongCard
            key={song.videoId}
            song={song}
            className='w-[42%] shrink-0 snap-start sm:w-52'
          />
        ))}
      </ul>
    </section>
  )
}

const SongShelf = ({ title, songs }: { title: string; songs: ListSong[] }) =>
  songs.length === 0 ? null : <Shelf title={title} songs={songs} />

// The rows under More Like This: the artist's other songs, then what this device played lately
export const Shelves = ({
  videoId,
  className,
}: {
  videoId: string
  className?: string
}) => {
  const { artist, songs: fromArtist } = useArtistSongs(videoId)
  const recent = useRecentlyPlayed(videoId)
  if (fromArtist.length === 0 && recent.length === 0) {
    return null
  }
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <SongShelf title={`More From ${artist}`} songs={fromArtist} />
      <SongShelf title='Recently Played' songs={recent} />
    </div>
  )
}
