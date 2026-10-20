import { motion } from 'motion/react'

import { cn } from '@/utils/cn'

const LOADER_SIZES = { lg: 44, md: 36, sm: 22, xl: 58, xs: 18 } as const

export type DotsLoaderSize = keyof typeof LOADER_SIZES | number

interface DotsLoaderProps {
  size?: DotsLoaderSize
  color?: string
  className?: string
}

const DOTS = [0, 1, 2] as const

const DotsLoader = ({
  size = 'md',
  color = '#fff',
  className,
}: DotsLoaderProps) => {
  const px = typeof size === 'number' ? size : LOADER_SIZES[size]
  const dot = px / 3 - px / 15

  return (
    <span
      className={cn('relative flex items-center justify-center', className)}
      style={{ gap: px / 10, height: px, width: px }}>
      {DOTS.map((i) => (
        <motion.span
          key={i}
          className='rounded-full'
          style={{ backgroundColor: color, height: dot, width: dot }}
          animate={{ opacity: [1, 0.5, 1], scale: [1, 0.6, 1] }}
          transition={{
            delay: i === 1 ? 0.4 : 0,
            duration: 0.8,
            ease: 'linear',
            repeat: Infinity,
          }}
        />
      ))}
    </span>
  )
}

export default DotsLoader
