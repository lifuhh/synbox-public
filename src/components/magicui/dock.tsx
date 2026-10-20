'use client'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { MotionValue } from 'motion/react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import type { PropsWithChildren } from 'react'
import React, { cloneElement, isValidElement, useRef } from 'react'

import { cn } from '@/utils/cn'

interface DockProps extends VariantProps<typeof dockVariants> {
  className?: string
  magnification?: number
  distance?: number
  children: React.ReactNode
}

const DEFAULT_MAGNIFICATION = 60
const DEFAULT_DISTANCE = 140

const dockVariants = cva(
  'mx-auto mt-8 flex h-[58px] w-max items-end gap-2 rounded-2xl border p-2 dark:border-[#707070]'
)

const Dock = React.forwardRef<HTMLDivElement, DockProps>(
  (
    {
      className,
      children,
      magnification = DEFAULT_MAGNIFICATION,
      distance = DEFAULT_DISTANCE,
      ...props
    },
    ref
  ) => {
    const mouseX = useMotionValue(Infinity)

    const renderChildren = () =>
      React.Children.map(children, (child): React.ReactNode =>
        isValidElement<DockIconProps>(child)
          ? cloneElement(child, { distance, magnification, mouseX })
          : child
      )

    return (
      <motion.div
        ref={ref}
        onMouseMove={(e) => {
          mouseX.set(e.pageX)
        }}
        onMouseLeave={() => {
          mouseX.set(Infinity)
        }}
        {...props}
        className={cn(dockVariants({ className }), className)}>
        {renderChildren()}
      </motion.div>
    )
  }
)

Dock.displayName = 'Dock'

interface DockIconProps {
  size?: number
  magnification?: number
  distance?: number
  mouseX?: MotionValue<number>
  className?: string
  onClick?: () => void
  children?: React.ReactNode
  props?: PropsWithChildren
}

const DockIcon = ({
  size,
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
  mouseX,
  className,
  children,
  ...props
}: DockIconProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const fallbackMouseX = useMotionValue(Infinity)

  const distanceCalc = useTransform(mouseX ?? fallbackMouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { width: 0, x: 0 }

    return val - bounds.x - bounds.width / 2
  })

  const widthSync = useTransform(
    distanceCalc,
    [-distance, 0, distance],
    [40, magnification, 40]
  )

  const width = useSpring(widthSync, {
    damping: 12,
    mass: 0.1,
    stiffness: 150,
  })

  return (
    <motion.div
      ref={ref}
      style={{ width }}
      className={cn(
        'flex aspect-square cursor-pointer items-center justify-center rounded-full bg-neutral-400/40',
        className
      )}
      {...props}>
      {children}
    </motion.div>
  )
}

DockIcon.displayName = 'DockIcon'

export { Dock, DockIcon }
