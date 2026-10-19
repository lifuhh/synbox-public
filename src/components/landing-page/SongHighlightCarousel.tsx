import Autoplay from 'embla-carousel-autoplay'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from '@/components/ui/carousel'
import type { CarouselApi } from '@/components/ui/carousel'
import { useLockBodyScrollOnHover } from '@/hooks/useLockScrollOnHover'
import { useGetLandingPagePlaylist } from '@/lib/react-query/queriesAndMutations'

import SongHighlightCarouselItem, {
  SongHighlightCarouselItemSkeleton,
} from './SongHighlightCarouselItem'

Autoplay.globalOptions = { delay: 7000 }

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
  const { data: playlistData, isLoading: isPlaylistDataFetching } =
    useGetLandingPagePlaylist()

  const slidesNumber = useMemo(() => playlistData?.length, [playlistData])

  const carouselRef = useRef<HTMLDivElement>(null)

  useLockBodyScrollOnHover(carouselRef, 640)

  const [api, setApi] = useState<CarouselApi | null>(null)
  const [current, setCurrent] = useState(1)

  useEffect(() => {
    if (!api) {
      return
    }

    setCurrent(api.selectedScrollSnap())

    let accumulatedDeltaX = 0
    const deltaXThreshold = 50
    let throttleTimeout: ReturnType<typeof setTimeout> | null = null

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document?.activeElement?.tagName !== 'INPUT') {
        switch (e.key) {
          case 'ArrowLeft': {
            api.scrollPrev()
            break
          }
          case 'ArrowRight': {
            api.scrollNext()
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

      if (!throttleTimeout) {
        throttleTimeout = setTimeout(() => {
          if (accumulatedDeltaX > deltaXThreshold) {
            api.scrollNext()
          } else if (accumulatedDeltaX < -deltaXThreshold) {
            api.scrollPrev()
          }
          accumulatedDeltaX = 0
          if (throttleTimeout) {
            clearTimeout(throttleTimeout)
          }
          throttleTimeout = null
        }, 100)
      }
    }

    const emblaContainer = api.containerNode()
    emblaContainer.addEventListener('wheel', handleWheel, { passive: true })
    api.on('select', () => {
      const newIndex = api.selectedScrollSnap()
      setCurrent(newIndex)
    })

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      emblaContainer.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [api])

  const carouselItems = useMemo(
    () =>
      playlistData && slidesNumber
        ? playlistData.map((item, itemIndex) => (
            <CarouselItem
              key={itemIndex}
              className={`sm:basis-2/5 sm:px-3 ${current == itemIndex ? 'z-30' : 'z-10'} `}>
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
    <div className='bg-dark-3 mt-2 flex h-96 w-full items-center justify-center rounded-md px-4 py-8 lg:w-7/12'>
      {isPlaylistDataFetching || !playlistData ? (
        <SongHighlightCarouselSkeleton />
      ) : (
        <div ref={carouselRef} className='overflow-hidden'>
          <Carousel
            opts={{
              loop: true,
              dragFree: true,
              containScroll: 'trimSnaps',
              startIndex: 1,
            }}
            setApi={setApi}
            plugins={[Autoplay()]}>
            <CarouselContent className='-ml-3'>{carouselItems}</CarouselContent>
          </Carousel>
        </div>
      )}
    </div>
  )
}
export default SongHighlightCarousel
