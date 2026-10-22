import { useVirtualizer } from '@tanstack/react-virtual'
import { PlayIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import {
  KaraokeLabel,
  KaraokePictureBadge,
} from '@/components/shared/karaoke-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SongMenu } from '@/components/watch/song-menu'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useGallerySongs } from '@/lib/react-query/queries-and-mutations'
import type { LibraryListSong } from '@/lib/synbox-flask/discovery'
import type { CssVars } from '@/types'

// The gallery is part of the page's own scroll, so a finger on it never gets caught in a box inside the page.
// Its title sticks under the top bar while the gallery is on screen, and a tap on it goes back to the
// gallery's start. Only the rows near the view exist. Every row is exactly as tall as the card width makes it
// (a 16:9 thumbnail plus fixed text), so rows are sized by that arithmetic and never measured: a measured row
// coming in above the view would move the scroll position to make up any difference, which stutters a scroll
// upwards. Every card is known from the first request; the footer follows the last one.
const GRID =
  'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
// gap-6 between cards and rows; py-4 above the first row and below the last
const GAP_PX = 24
const PAD_PX = 16
// Under the full-width thumbnail: mt-3 12 + the text block 72 (h-18: two title lines 48, gap 4, channel 20)
const CARD_CHROME_PX = 84

// Picture first, like the recommendations above, with no box around it; the text has fixed heights so a row's
// height follows from its width alone
// The card opens the song; its menu (Play Next, Add to Queue, Save to Playlist) sits beside the title, outside
// the link, at the top of the fixed text block
const SongCard = ({ song }: { song: LibraryListSong }) => (
  <div className='relative'>
    <Link
      data-bench='gallery-tile'
      to={`/v/${song.videoId}`}
      state={{ videoId: song.videoId }}
      title={song.title}
      className='group block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      <span className='relative block aspect-video overflow-hidden rounded-xl bg-thumbnail-placeholder'>
        {/* YouTube's 480×360 picture (object-cover crops its letterbox), not the 1280×720 one the list
            gives: decoding dozens of those stalls scrolling on a phone */}
        <img
          src={`https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}
          alt=''
          loading='lazy'
          decoding='async'
          className='size-full object-cover transition-transform duration-500 group-hover:scale-104 motion-reduce:transition-none'
        />
        <span className='absolute right-2.5 bottom-2.5 grid size-10 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'>
          <PlayIcon className='size-4 fill-current' aria-hidden />
        </span>
        {song.karaoke && <KaraokePictureBadge />}
      </span>
      {/* A fixed-height block, so every row is the same height; the channel sits right under one line or two */}
      <span className='mt-3 flex h-18 flex-col gap-1 pe-10'>
        <span className='line-clamp-2 text-base leading-6 font-semibold text-foreground'>
          {song.title}
        </span>
        {song.karaoke && <KaraokeLabel />}
        <span className='truncate text-sm leading-5 text-muted-foreground'>
          {song.author}
        </span>
      </span>
    </Link>
    <div className='absolute end-0 bottom-8'>
      <SongMenu song={song} />
    </div>
  </div>
)

const CardSkeleton = () => (
  <div>
    <Skeleton shape='card' className='aspect-video w-full' />
    <div className='mt-3 flex h-18 flex-col gap-2 pt-1'>
      <Skeleton className='h-4 w-3/4' />
      <Skeleton className='h-3.5 w-1/3' />
    </div>
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
  const rowHeight = (cardWidth * 9) / 16 + CARD_CHROME_PX
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
    <ul className='relative h-(--gallery-h) appear' style={listVars}>
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
  const { isLoading, isSuccess, songs } = useGallerySongs()
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
      data-bench='gallery'
      className='relative mt-12 pb-page-bottom'>
      <h2
        ref={title}
        id='gallery-title'
        data-stuck={stuck ? true : undefined}
        className='sticky-under-topbar px-4 pb-1.5 text-xl font-semibold tracking-tight text-foreground md:px-0'>
        <button type='button' onClick={toStart} className='py-0.5'>
          Gallery
        </button>
      </h2>
      {/* The padding sits outside the measured box: a row's height follows from its content width */}
      <div className='px-4 md:px-0'>
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
        {/* The whole list comes in one request, so once it is here this is the end */}
        {isSuccess && songs.length > 0 && (
          <p
            data-gallery-end
            className='appear pt-6 text-center text-sm text-faint'>
            That&apos;s every song in the gallery, for now
          </p>
        )}
      </div>
    </section>
  )
}

export default SongGallery
