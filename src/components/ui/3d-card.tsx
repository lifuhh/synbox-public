import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/utils/cn'

const MouseEnterContext = createContext<
  [boolean, React.Dispatch<React.SetStateAction<boolean>>] | undefined
>(undefined)

const useMouseEnter = () => {
  const context = useContext(MouseEnterContext)
  if (context === undefined) {
    throw new Error('useMouseEnter must be used within a MouseEnterProvider')
  }
  return context
}

export const CardContainer = ({
  children,
  className,
  containerClassName,
}: {
  children?: React.ReactNode
  className?: string
  containerClassName?: string
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isMouseEntered, setIsMouseEntered] = useState(false)
  const mouseEnter = useMemo<
    [boolean, React.Dispatch<React.SetStateAction<boolean>>]
  >(() => [isMouseEntered, setIsMouseEntered], [isMouseEntered])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) {
      return
    }
    const { left, top, width, height } =
      containerRef.current.getBoundingClientRect()
    const x = (e.clientX - left - width / 2) / 25
    const y = (e.clientY - top - height / 2) / 25
    containerRef.current.style.transform = `rotateY(${x}deg) rotateX(${y}deg)`
  }

  const handleMouseEnter = () => {
    setIsMouseEntered(true)
  }

  const handleMouseLeave = () => {
    if (!containerRef.current) {
      return
    }
    setIsMouseEntered(false)
    containerRef.current.style.transform = `rotateY(0deg) rotateX(0deg)`
  }
  return (
    <MouseEnterContext.Provider value={mouseEnter}>
      <div
        className={cn(
          'flex items-center justify-center perspective-[1000px]',
          containerClassName
        )}>
        <div
          ref={containerRef}
          onMouseEnter={handleMouseEnter}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className={cn(
            'relative flex items-center justify-center transition-all duration-200 ease-linear transform-3d',
            className
          )}>
          {children}
        </div>
      </div>
    </MouseEnterContext.Provider>
  )
}

const cardBodyVariants = cva('', {
  defaultVariants: { variant: 'default' },
  variants: {
    variant: {
      default: '',
      // The landing carousel's card: a bordered panel that glows on hover
      highlight:
        'rounded-xl border border-primary/70 bg-muted p-6 transition-shadow duration-300 ease-in-out dark:hover:shadow-2xl dark:hover:shadow-primary/15',
    },
  },
})

export const CardBody = ({
  children,
  className,
  variant,
}: {
  children: React.ReactNode
  className?: string
} & VariantProps<typeof cardBodyVariants>) => (
  <div
    className={cn(
      'h-96 w-96 transform-3d *:transform-3d',
      cardBodyVariants({ variant }),
      className
    )}>
    {children}
  </div>
)

const cardItemVariants = cva('', {
  defaultVariants: { variant: 'default' },
  variants: {
    variant: {
      // A small label in a pill, such as the channel name
      caption:
        'unselectable rounded-xl px-4 py-1 text-base font-normal text-white',
      default: '',
      title: 'text-xl font-bold text-card-foreground shadow-xs unhighlightable',
    },
  },
})

export const CardItem = ({
  as: Tag = 'div',
  children,
  className,
  translateX = 0,
  translateY = 0,
  translateZ = 0,
  rotateX = 0,
  rotateY = 0,
  rotateZ = 0,
  variant,
  ...rest
}: {
  as?: React.ElementType
  children: React.ReactNode
  className?: string
  translateX?: number | string
  translateY?: number | string
  translateZ?: number | string
  rotateX?: number | string
  rotateY?: number | string
  rotateZ?: number | string
} & React.HTMLAttributes<HTMLElement> &
  VariantProps<typeof cardItemVariants>) => {
  const ref = useRef<HTMLDivElement>(null)
  const [isMouseEntered] = useMouseEnter()

  useEffect(() => {
    if (!ref.current) {
      return
    }
    ref.current.style.transform = isMouseEntered
      ? `translateX(${translateX}px) translateY(${translateY}px) translateZ(${translateZ}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`
      : `translateX(0px) translateY(0px) translateZ(0px) rotateX(0deg) rotateY(0deg) rotateZ(0deg)`
  }, [
    isMouseEntered,
    rotateX,
    rotateY,
    rotateZ,
    translateX,
    translateY,
    translateZ,
  ])

  return (
    <Tag
      ref={ref}
      className={cn(
        'w-fit transition duration-200 ease-linear',
        cardItemVariants({ variant }),
        className
      )}
      {...rest}>
      {children}
    </Tag>
  )
}
