import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { Skeleton } from '@/components/ui/skeleton'
import { useMediaQuery } from '@/hooks/use-media-query'
import type { GallerySong } from '@/lib/appwrite/api'
import { useGallerySongs } from '@/lib/react-query/queries-and-mutations'
import type { CssVars } from '@/types'

import HomeFooter from '../shared/home-footer'
import { Spotlight } from '../ui/spotlight'

// The gallery scrolls in its own box, sized with the footer below it to fill the screen under the top bar,
// so the page ends at the footer however many songs there are. Inside, only the rows near the view exist:
// each row's height follows from the card width (a 16:9 thumbnail plus fixed text), so the estimate is
// right before a row is measured and nothing jumps when rows come and go. More cards load as the view
// nears the end of the ones loaded.
const GRID =
  'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
const CARD = 'block rounded-xl border bg-muted p-4'
// gap-6 between cards and rows; py-4 above the first row and below the last
const GAP_PX = 24
const PAD_PX = 16
// Border 2 + padding 32 + title line 28 + artist line 20 + its margin 12
const CARD_CHROME_PX = 94
// Load the next cards when the view is this many rows from the end of the loaded ones
const LOAD_AHEAD_ROWS = 2

const SongCard = ({ song }: { song: GallerySong }) => (
  <Link
    to={`/v/${song.videoId}`}
    state={{ videoId: song.videoId }}
    className={`${CARD} transition-colors duration-300 hover:border-ring hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden`}>
    <p className='truncate text-lg font-bold tracking-wide text-song-title'>
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

const CardSkeleton = () => (
  <div className={CARD}>
    <Skeleton className='mb-2 h-7 w-3/4' />
    <Skeleton className='mb-3 h-5 w-1/3' />
    <Skeleton shape='thumbnail' className='aspect-video w-full' />
  </div>
)

// The GRID's column count at this width (Tailwind's sm, lg and 2xl breakpoints)
const useColumns = () => {
  const sm = useMediaQuery('(min-width: 40rem)')
  const lg = useMediaQuery('(min-width: 64rem)')
  const xxl = useMediaQuery('(min-width: 96rem)')
  if (xxl) {
    return 4
  }
  if (lg) {
    return 3
  }
  return sm ? 2 : 1
}

// The content width of the scroll box, following resizes
const useContentWidth = (element: HTMLElement | null) => {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    if (element !== null) {
      observer.observe(element)
    }
    return () => {
      observer.disconnect()
    }
  }, [element])
  return width
}

const VirtualRows = ({ scroller }: { scroller: HTMLDivElement | null }) => {
  const { fetchNextPage, hasNextPage, isFetchingNextPage, songs } =
    useGallerySongs()
  const columns = useColumns()
  const width = useContentWidth(scroller)
  const cardWidth = (width - (columns - 1) * GAP_PX) / columns
  const rowHeight = (cardWidth * 9) / 16 + CARD_CHROME_PX
  const rows = Array.from(
    { length: Math.ceil(songs.length / columns) },
    (_, index) => songs.slice(index * columns, (index + 1) * columns)
  )
  // One row of skeletons stands in for the cards still to load
  const count = rows.length + (hasNextPage ? 1 : 0)

  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual hands back new functions each render, so the compiler leaves this component unmemoized, which is what it needs
  const virtualizer = useVirtualizer({
    count,
    estimateSize: () => rowHeight,
    gap: GAP_PX,
    getScrollElement: () => scroller,
    overscan: 2,
    paddingEnd: PAD_PX,
    paddingStart: PAD_PX,
  })

  // A new width or column count changes every row's height
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowHeight])

  const items = virtualizer.getVirtualItems()
  const lastShown = items.at(-1)?.index ?? 0
  useEffect(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      lastShown >= rows.length - LOAD_AHEAD_ROWS
    ) {
      void fetchNextPage()
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, lastShown, rows.length])

  const listVars: CssVars = { '--gallery-h': `${virtualizer.getTotalSize()}px` }
  return (
    <ul className='relative h-(--gallery-h)' style={listVars}>
      {items.map((item) => {
        const row = rows.at(item.index)
        const rowVars: CssVars = { '--row-y': `${item.start}px` }
        return (
          <li
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className={`absolute inset-x-0 top-0 translate-y-(--row-y) ${GRID}`}
            style={rowVars}>
            {row === undefined
              ? Array.from({ length: columns }, (_, index) => (
                  // oxlint-disable-next-line no-array-index-key
                  <CardSkeleton key={index} />
                ))
              : row.map((song) => <SongCard key={song.videoId} song={song} />)}
          </li>
        )
      })}
    </ul>
  )
}

// A first screen's worth at every column count
const SKELETON_CARDS = 8

const SongGallery = () => {
  const { isLoading } = useGallerySongs()
  // State, not a ref: the virtualizer needs the box once it exists
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)

  return (
    <section className='relative flex h-[calc(100dvh-var(--topbar-h))] flex-col px-2 sm:px-6'>
      {/* The glow is 169 % of this section tall and shifted up 40 % of that, so its bottom lands at
          top + 101.4 % of the section. Any top lower than -1.4 % of the section keeps it above the
          footer; a higher one makes the page scroll on past the footer */}
      <Spotlight
        className='-top-80 left-40 scale-x-[-1] md:-top-8 md:-left-40'
        fill='#580a24'
      />
      <div
        ref={setScroller}
        className='custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2'>
        {isLoading ? (
          <output aria-label='Loading gallery' className={`${GRID} py-4`}>
            {Array.from({ length: SKELETON_CARDS }, (_, index) => (
              // oxlint-disable-next-line no-array-index-key
              <CardSkeleton key={index} />
            ))}
          </output>
        ) : (
          <VirtualRows scroller={scroller} />
        )}
      </div>
      <HomeFooter />
    </section>
  )
}

export default SongGallery
