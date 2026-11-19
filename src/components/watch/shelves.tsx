import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { wheelSideways } from '@/hooks/wheel-sideways'
import type { ListSong } from '@/lib/listening/model'
import {
  useArtistSongs,
  useRecentlyPlayed,
  useRecentlyPlayedEverywhere,
} from '@/lib/listening/shelves'
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

// One sideways row of song cards under a heading. Fingers swipe it; a mouse gets arrows beside the heading, and its
// wheel scrolls the row while pointing at it.
// The row reaches past the page's side padding by --shelf-bleed (the page sets it to its gutter to run the row to
// the screen's edges, so cards cut off at both ends say it scrolls) and pads back in, so the first card still
// starts under the heading and snaps there
const Shelf = ({ title, songs }: { title: string; songs: ListSong[] }) => {
  const id = useId()
  const { ends, ref } = useEnds()
  const rowRef = useCallback(
    (el: HTMLUListElement | null) => {
      ref.current = el
      return wheelSideways(el)
    },
    [ref]
  )
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
        ref={rowRef}
        className='-mx-(--shelf-bleed,0.25rem) no-scrollbar flex snap-x snap-mandatory scroll-px-(--shelf-bleed,0.25rem) gap-4 overflow-x-auto overscroll-x-contain px-(--shelf-bleed,0.25rem) py-1'>
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

// The rows under the song: songs like it past the ones in Up Next, the artist's other songs, what anyone on Synbox
// played lately, then what this device did
export const Shelves = ({
  videoId,
  similar,
  className,
}: {
  videoId: string
  similar: ListSong[]
  className?: string
}) => {
  const { artist, songs: fromArtist } = useArtistSongs(videoId)
  const everywhere = useRecentlyPlayedEverywhere(videoId)
  const recent = useRecentlyPlayed(videoId)
  if (
    similar.length === 0 &&
    fromArtist.length === 0 &&
    everywhere.length === 0 &&
    recent.length === 0
  ) {
    return null
  }
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <SongShelf title='More Like This' songs={similar} />
      <SongShelf title={`More From ${artist}`} songs={fromArtist} />
      <SongShelf title='Recently Played on Synbox' songs={everywhere} />
      <SongShelf title='Your History' songs={recent} />
    </div>
  )
}
