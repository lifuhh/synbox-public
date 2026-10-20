'use client'

import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import useEmblaCarousel from 'embla-carousel-react'
import type { UseEmblaCarouselType } from 'embla-carousel-react'
import * as React from 'react'

import { cn } from '@/utils/cn'

type CarouselApi = UseEmblaCarouselType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

interface CarouselProps {
  opts?: CarouselOptions
  plugins?: CarouselPlugin
  orientation?: 'horizontal' | 'vertical'
  setApi?: (api: CarouselApi) => void
}

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0]
  api: ReturnType<typeof useEmblaCarousel>[1]
  scrollPrev: () => void
  scrollNext: () => void
  canScrollPrev: boolean
  canScrollNext: boolean
} & CarouselProps

const CarouselContext = React.createContext<CarouselContextProps | null>(null)

const useCarousel = () => {
  const context = React.useContext(CarouselContext)

  if (!context) {
    throw new Error('useCarousel must be used within a <Carousel />')
  }

  return context
}

const CarouselRender: React.ForwardRefRenderFunction<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & CarouselProps
> = (
  {
    orientation = 'horizontal',
    opts,
    setApi,
    plugins,
    className,
    children,
    ...props
  },
  ref
) => {
  const [carouselRef, api] = useEmblaCarousel(
    {
      ...opts,
      axis: orientation === 'horizontal' ? 'x' : 'y',
    },
    plugins
  )
  const [canScrollPrev, setCanScrollPrev] = React.useState(false)
  const [canScrollNext, setCanScrollNext] = React.useState(false)

  const onSelect = React.useCallback((emblaApi: CarouselApi) => {
    if (!emblaApi) {
      return
    }

    setCanScrollPrev(emblaApi.canScrollPrev())
    setCanScrollNext(emblaApi.canScrollNext())
  }, [])

  const scrollPrev = React.useCallback(() => {
    api?.scrollPrev()
  }, [api])

  const scrollNext = React.useCallback(() => {
    api?.scrollNext()
  }, [api])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        scrollPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        scrollNext()
      }
    },
    [scrollPrev, scrollNext]
  )

  React.useEffect(() => {
    if (!api || !setApi) {
      return
    }

    setApi(api)
  }, [api, setApi])

  React.useEffect(() => {
    if (api) {
      // oxlint-disable-next-line react/set-state-in-effect -- reads the starting position from Embla, an outside system, once its API exists
      onSelect(api)
      api.on('reInit', onSelect)
      api.on('select', onSelect)
    }

    return () => {
      api?.off('select', onSelect)
    }
  }, [api, onSelect])

  const context = React.useMemo<CarouselContextProps>(
    () => ({
      api,
      canScrollNext,
      canScrollPrev,
      carouselRef,
      opts,
      orientation:
        orientation || (opts?.axis === 'y' ? 'vertical' : 'horizontal'),
      scrollNext,
      scrollPrev,
    }),
    [
      api,
      canScrollNext,
      canScrollPrev,
      carouselRef,
      opts,
      orientation,
      scrollNext,
      scrollPrev,
    ]
  )

  return (
    <CarouselContext.Provider value={context}>
      <section
        ref={ref}
        onKeyDownCapture={handleKeyDown}
        className={cn('relative', className)}
        aria-roledescription='carousel'
        {...props}>
        {children}
      </section>
    </CarouselContext.Provider>
  )
}
const Carousel = React.forwardRef(CarouselRender)
Carousel.displayName = 'Carousel'

const CarouselContentRender: React.ForwardRefRenderFunction<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
> = ({ className, ...props }, ref) => {
  const { carouselRef, orientation } = useCarousel()

  return (
    <div ref={carouselRef} className='overflow-hidden'>
      <div
        ref={ref}
        className={cn(
          'flex',
          orientation === 'horizontal' ? '-ml-4' : '-mt-4 flex-col',
          className
        )}
        {...props}
      />
    </div>
  )
}
const CarouselContent = React.forwardRef(CarouselContentRender)
CarouselContent.displayName = 'CarouselContent'

const carouselItemVariants = cva('', {
  defaultVariants: { gutter: 'default' },
  variants: {
    // Extra space either side of a slide from the sm breakpoint
    gutter: {
      default: '',
      wide: 'sm:px-3',
    },
  },
})

const CarouselItemRender: React.ForwardRefRenderFunction<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> &
    VariantProps<typeof carouselItemVariants>
> = ({ className, gutter, ...props }, ref) => {
  const { orientation } = useCarousel()

  return (
    <div
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the ARIA carousel pattern makes each slide a group with aria-roledescription='slide'; no HTML tag means that
      role='group'
      aria-roledescription='slide'
      className={cn(
        'min-w-0 shrink-0 grow-0 basis-full',
        orientation === 'horizontal' ? 'pl-4' : 'pt-4',
        carouselItemVariants({ gutter }),
        className
      )}
      {...props}
    />
  )
}
const CarouselItem = React.forwardRef(CarouselItemRender)
CarouselItem.displayName = 'CarouselItem'

export { Carousel, CarouselContent, CarouselItem, type CarouselApi }
