import type { CSSProperties } from 'react'
import { useCallback } from 'react'
import { useNavigate } from 'react-router'

import type { formattedYoutubeVideoItemForCarousel } from '@/types'

import { CardBody, CardContainer, CardItem } from '../ui/3d-card'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'

interface SlidePosition {
  index: number
  currentIndex: number
  itemCount: number
}

interface SongHighlightCarouselItemProps extends SlidePosition {
  opacity: number
  item: formattedYoutubeVideoItemForCarousel
}

// Computed during render so a slide mounts at its final scale instead of animating from full size
const getSlideStyle = (
  index: number,
  currentIndex: number,
  itemCount: number
): CSSProperties => {
  const adjustedIndex = index - 1
  let distance = Math.abs(adjustedIndex - currentIndex)

  if (currentIndex === 0 && adjustedIndex === itemCount - 1) {
    distance = 1
  } else if (currentIndex === itemCount - 1 && adjustedIndex === 0) {
    distance = 1
  } else {
    distance = Math.min(distance, itemCount - distance)
  }

  const scaleBase = 0.18
  const scale = 1 - scaleBase * distance
  const opacityDecrement = 0.18
  const opacityInRange = Math.max(1 - opacityDecrement * distance, 0.2)

  return {
    opacity: opacityInRange,
    transform: `scale(${scale})`,
    transition: 'transform 0.5s ease-in-out, opacity 0.3s ease-in-out',
  }
}

const SlideFrame = ({
  index,
  currentIndex,
  itemCount,
  children,
}: SlidePosition & { children: React.ReactNode }) => (
  <div style={getSlideStyle(index, currentIndex, itemCount)}>{children}</div>
)

const CARD_BODY_CLASS =
  'relative h-auto w-120 rounded-xl border border-primary/70 bg-muted p-6'

const SongHighlightCarouselItem = ({
  opacity,
  index,
  currentIndex,
  itemCount,
  item,
}: SongHighlightCarouselItemProps) => {
  const navigate = useNavigate()

  const handleNavigate = useCallback(() => {
    navigate(`/v/${item.videoId}`, { state: { videoId: item.videoId } })
  }, [item.videoId, navigate])

  return (
    <div style={{ opacity }} className='scale-75'>
      <SlideFrame
        index={index}
        currentIndex={currentIndex}
        itemCount={itemCount}>
        <CardContainer>
          <CardBody
            className={`group/card ${CARD_BODY_CLASS} transition-shadow duration-300 ease-in-out dark:hover:shadow-2xl dark:hover:shadow-primary/15`}>
            <CardItem
              translateZ='50'
              as='button'
              className='max-h-12 min-h-12 text-left text-xl font-bold text-card-foreground shadow-xs unhighlightable'
              onClick={handleNavigate}>
              {item.title}
            </CardItem>
            <CardItem
              translateZ='120'
              rotateX={10}
              rotateZ={-3}
              className='my-2 w-full cursor-pointer'
              onClick={handleNavigate}>
              <img
                src={item.thumbnailUrl}
                height='1080'
                width='1920'
                className='unselectable h-60 w-full rounded-xl object-cover group-hover/card:shadow-xl'
                alt='thumbnail'
              />
            </CardItem>
            <div className='mt-6 flex justify-between'>
              <CardItem
                translateZ={10}
                className='unselectable rounded-xl px-4 py-1 text-base font-normal text-white'>
                {item.channel}
              </CardItem>
              <Button
                className='rounded-xl bg-white px-4 py-2 text-sm font-bold text-primary/80 hover:bg-primary/80 hover:text-foreground [&:hover]:transition-none [&:hover]:duration-0'
                onClick={handleNavigate}
                variant='default'>
                <CardItem translateZ={10}>Watch Now</CardItem>
              </Button>
            </div>
          </CardBody>
        </CardContainer>
      </SlideFrame>
    </div>
  )
}

// Same box model as SongHighlightCarouselItem: title row h-12, thumbnail my-2 h-60, footer row h-10
export const SongHighlightCarouselItemSkeleton = ({
  index,
  currentIndex,
  itemCount,
}: SlidePosition) => (
  <div className='scale-75'>
    <SlideFrame index={index} currentIndex={currentIndex} itemCount={itemCount}>
      <div className='flex items-center justify-center'>
        <div className={`shrink-0 ${CARD_BODY_CLASS}`}>
          <div className='flex h-12 items-center'>
            <Skeleton className='h-6 w-4/5' />
          </div>
          <div className='my-2 h-60 overflow-hidden rounded-xl'>
            <Skeleton className='size-full' />
          </div>
          <div className='mt-6 flex items-center justify-between'>
            <Skeleton className='ml-4 h-5 w-28' />
            <div className='h-10 w-28 overflow-hidden rounded-xl'>
              <Skeleton className='size-full' />
            </div>
          </div>
        </div>
      </div>
    </SlideFrame>
  </div>
)

export default SongHighlightCarouselItem
