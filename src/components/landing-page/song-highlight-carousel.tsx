import autoplay from 'embla-carousel-autoplay'
import { useEffect, useMemo, useRef, useState } from 'react'

import LoadError from '@/components/shared/load-error'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from '@/components/ui/carousel'
import type { CarouselApi } from '@/components/ui/carousel'
import { useLockBodyScrollOnHover } from '@/hooks/use-lock-scroll-on-hover'
import { useGetLandingPagePlaylist } from '@/lib/react-query/queries-and-mutations'

import SongHighlightCarouselItem, {
  SongHighlightCarouselItemSkeleton,
} from './song-highlight-carousel-item'

autoplay.globalOptions = { delay: 7000 }

// Embla centres the start slide; an overflowing `justify-center` row puts the middle
// slide in the same place without waiting for Embla to initialise
const SongHighlightCarouselSkeleton = () => (
  <output
    className='block overflow-hidden'
    aria-label='Loading recommendations'>
    <div className='overflow-hidden'>
      <div className='-ml-3 flex justify-center'>
        {[0, 1, 2].map((slideIndex) => (
          <div
            key={slideIndex}
            className={`min-w-0 shrink-0 grow-0 basis-full pl-4 sm:basis-2/5 sm:px-3 ${slideIndex === 1 ? 'z-30' : 'z-10'}`}>
            <SongHighlightCarouselItemSkeleton
              index={slideIndex + 1}
              currentIndex={1}
              itemCount={3}
            />
          </div>
        ))}
      </div>
    </div>
  </output>
)

const SongHighlightCarousel = () => {
  const {
    data: playlistData,
    isLoading: isPlaylistDataFetching,
    isError,
    isFetching,
    refetch,
  } = useGetLandingPagePlaylist()

  const slidesNumber = useMemo(() => playlistData?.length, [playlistData])

  const carouselRef = useRef<HTMLDivElement>(null)

  useLockBodyScrollOnHover(carouselRef, 640)

  const [api, setApi] = useState<CarouselApi | null>(null)
  const [current, setCurrent] = useState(1)

  useEffect(() => {
    const bind = (embla: NonNullable<CarouselApi>) => {
      setCurrent(embla.selectedScrollSnap())

      let accumulatedDeltaX = 0
      const deltaXThreshold = 50
      let throttleTimeout: ReturnType<typeof setTimeout> | null = null

      const handleKeyDown = (e: KeyboardEvent) => {
        // The Carousel already moved for an arrow pressed while focus is inside it
        if (
          !e.defaultPrevented &&
          document?.activeElement?.tagName !== 'INPUT'
        ) {
          switch (e.key) {
            case 'ArrowLeft': {
              embla.scrollPrev()
              break
            }
            case 'ArrowRight': {
              embla.scrollNext()
              break
            }
            default: {
              break
            }
          }
        }
      }

      const handleWheel = (e: WheelEvent) => {
        accumulatedDeltaX += e.deltaX

        if (throttleTimeout) {
          return
        }
        throttleTimeout = setTimeout(() => {
          if (accumulatedDeltaX > deltaXThreshold) {
            embla.scrollNext()
          } else if (accumulatedDeltaX < -deltaXThreshold) {
            embla.scrollPrev()
          }
          accumulatedDeltaX = 0
          if (throttleTimeout) {
            clearTimeout(throttleTimeout)
          }
          throttleTimeout = null
        }, 100)
      }

      const emblaContainer = embla.containerNode()
      emblaContainer.addEventListener('wheel', handleWheel, { passive: true })
      const handleSelect = () => {
        setCurrent(embla.selectedScrollSnap())
      }
      embla.on('select', handleSelect)

      window.addEventListener('keydown', handleKeyDown)

      return () => {
        emblaContainer.removeEventListener('wheel', handleWheel)
        window.removeEventListener('keydown', handleKeyDown)
        embla.off('select', handleSelect)
      }
    }
    return api ? bind(api) : undefined
  }, [api])

  const carouselItems = useMemo(
    () =>
      playlistData !== undefined &&
      slidesNumber !== undefined &&
      slidesNumber > 0
        ? playlistData.map((item, itemIndex) => (
            <CarouselItem
              key={itemIndex}
              gutter='wide'
              className={`sm:basis-2/5 ${current === itemIndex ? 'z-30' : 'z-10'} `}>
              <SongHighlightCarouselItem
                opacity={1}
                index={itemIndex + 1}
                currentIndex={current}
                itemCount={slidesNumber}
                item={item}
              />
            </CarouselItem>
          ))
        : '',
    [playlistData, slidesNumber, current]
  )

  return (
    // The ref sits on the wrapper that renders before the playlist, so the scroll lock attaches on first load
    <div
      ref={carouselRef}
      className='mt-2 flex h-96 w-full items-center justify-center rounded-md px-4 py-8 lg:w-7/12'>
      {isError && (
        <LoadError
          message="Couldn't load the recommendations."
          retrying={isFetching}
          onRetry={() => {
            void refetch()
          }}
          className='size-full rounded-xl border border-primary/30'
        />
      )}
      {!isError &&
        (isPlaylistDataFetching || !playlistData ? (
          <SongHighlightCarouselSkeleton />
        ) : (
          <div className='overflow-hidden'>
            <Carousel
              opts={{
                containScroll: 'trimSnaps',
                dragFree: true,
                loop: true,
                startIndex: 1,
              }}
              setApi={setApi}
              plugins={[autoplay()]}>
              <CarouselContent className='-ml-3'>
                {carouselItems}
              </CarouselContent>
            </Carousel>
          </div>
        ))}
    </div>
  )
}
export default SongHighlightCarousel
