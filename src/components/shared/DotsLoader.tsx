import { motion } from 'motion/react'

import { cn } from '@/utils/cn'

const LOADER_SIZES = { xs: 18, sm: 22, md: 36, lg: 44, xl: 58 } as const

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
      style={{ width: px, height: px, gap: px / 10 }}>
      {DOTS.map((i) => (
        <motion.span
          key={i}
          className='rounded-full'
          style={{ width: dot, height: dot, backgroundColor: color }}
          animate={{ scale: [1, 0.6, 1], opacity: [1, 0.5, 1] }}
          transition={{
            duration: 0.8,
            ease: 'linear',
            repeat: Infinity,
            delay: i === 1 ? 0.4 : 0,
          }}
        />
      ))}
    </span>
  )
}

export default DotsLoader
