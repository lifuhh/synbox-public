import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { Skeleton } from '@/components/ui/skeleton'
import { useMediaQuery } from '@/hooks/use-media-query'
import type { GallerySong } from '@/lib/appwrite/api'
import { useGallerySongs } from '@/lib/react-query/queries-and-mutations'
import type { CssVars } from '@/types'

import HomeFooter from '../shared/home-footer'

// The gallery is part of the page's own scroll, so a finger on it never gets caught in a box inside the page.
// Its title sticks under the top bar while the gallery is on screen, and a tap on it goes back to the
// gallery's start. Only the rows near the view exist. Every row is exactly as tall as the card width makes it
// (a 16:9 thumbnail plus fixed text), so rows are sized by that arithmetic and never measured: a measured row
// coming in above the view would move the scroll position to make up any difference, which stutters a scroll
// upwards. Every card is known from the first request; the footer follows the last one.
const GRID =
  'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
const CARD = 'block rounded-xl bg-card p-4'
// gap-6 between cards and rows; py-4 above the first row and below the last
const GAP_PX = 24
const PAD_PX = 16
// Padding 32 + title line 28 + artist line 20 + its margin 12
const CARD_CHROME_PX = 92
// The thumbnail is the card's width less its padding (p-4 on both sides)
const CARD_PAD_X_PX = 32

const SongCard = ({ song }: { song: GallerySong }) => (
  <Link
    to={`/v/${song.videoId}`}
    state={{ videoId: song.videoId }}
    className={`${CARD} transition-colors duration-300 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden`}>
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

// The list's width, and how far down the page scroller it starts, following resizes of anything above it
const useListBox = (list: HTMLElement | null, scroller: HTMLElement | null) => {
  const [box, setBox] = useState({ top: 0, width: 0 })
  useEffect(() => {
    const measure = () => {
      if (list === null || scroller === null) {
        return
      }
      const top =
        list.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop
      setBox((current) =>
        current.top === top && current.width === list.clientWidth
          ? current
          : { top, width: list.clientWidth }
      )
    }
    const observer = new ResizeObserver(measure)
    for (const element of [list, ...(scroller?.children ?? [])]) {
      if (element !== null) {
        observer.observe(element)
      }
    }
    return () => {
      observer.disconnect()
    }
  }, [list, scroller])
  return box
}

const VirtualRows = ({
  list,
  scroller,
}: {
  list: HTMLElement | null
  scroller: HTMLElement | null
}) => {
  const { songs } = useGallerySongs()
  const columns = useColumns()
  const { top, width } = useListBox(list, scroller)
  const cardWidth = (width - (columns - 1) * GAP_PX) / columns
  const rowHeight = ((cardWidth - CARD_PAD_X_PX) * 9) / 16 + CARD_CHROME_PX
  const rows = Array.from(
    { length: Math.ceil(songs.length / columns) },
    (_, index) => songs.slice(index * columns, (index + 1) * columns)
  )
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual hands back new functions each render, so the compiler leaves this component unmemoized, which is what it needs
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    gap: GAP_PX,
    getScrollElement: () => scroller,
    overscan: 2,
    paddingEnd: PAD_PX,
    paddingStart: PAD_PX,
    scrollMargin: top,
  })

  // A new width or column count changes every row's height
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowHeight])

  const listVars: CssVars = {
    '--gallery-h': `${virtualizer.getTotalSize()}px`,
    '--row-h': `${rowHeight}px`,
  }
  return (
    <ul className='relative h-(--gallery-h)' style={listVars}>
      {virtualizer.getVirtualItems().map((item) => {
        const rowVars: CssVars = {
          '--row-y': `${item.start - virtualizer.options.scrollMargin}px`,
        }
        return (
          <li
            key={item.key}
            className={`absolute inset-x-0 top-0 h-(--row-h) translate-y-(--row-y) ${GRID}`}
            style={rowVars}>
            {rows[item.index].map((song) => (
              <SongCard key={song.videoId} song={song} />
            ))}
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
  // State, not refs: the virtualizer needs both once they exist
  const [section, setSection] = useState<HTMLElement | null>(null)
  const [list, setList] = useState<HTMLDivElement | null>(null)
  const scroller = section?.closest<HTMLElement>('[data-scroll-top]') ?? null
  const title = useRef<HTMLHeadingElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const top = title.current?.getBoundingClientRect().top ?? 0
      setStuck((section?.getBoundingClientRect().top ?? 0) < top - 0.5)
    }
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller?.removeEventListener('scroll', onScroll)
    }
  }, [scroller, section])

  // Brings the gallery's start up under the title, from above it or from deep in it. Scrolling up brings the
  // top bar back, so the start goes under the whole bar
  const toStart = () => {
    if (scroller === null || section === null) {
      return
    }
    scroller.scrollTo({
      behavior: 'smooth',
      top:
        scroller.scrollTop +
        section.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        (document.querySelector('[data-topbar]')?.getBoundingClientRect()
          .height ?? 0),
    })
  }

  return (
    <section
      ref={setSection}
      aria-labelledby='gallery-title'
      className='relative mt-12'>
      <h2
        ref={title}
        id='gallery-title'
        data-stuck={stuck ? true : undefined}
        className='sticky-under-topbar z-10 px-4 pb-3 text-xl font-semibold tracking-tight text-foreground sm:px-8'>
        <button type='button' onClick={toStart} className='py-1'>
          Gallery
        </button>
      </h2>
      {/* The padding sits outside the measured box: a row's height follows from its content width */}
      <div className='px-4 sm:px-8'>
        <div ref={setList}>
          {isLoading ? (
            <output aria-label='Loading gallery' className={`${GRID} py-4`}>
              {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                // oxlint-disable-next-line no-array-index-key
                <CardSkeleton key={index} />
              ))}
            </output>
          ) : (
            <VirtualRows list={list} scroller={scroller} />
          )}
        </div>
      </div>
      {!isLoading && <HomeFooter />}
    </section>
  )
}

export default SongGallery
