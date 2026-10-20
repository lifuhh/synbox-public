import { motion } from 'motion/react'

import type { CssVars } from '@/types'
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
  const loaderVars: CssVars = {
    '--dots-gap': `${px / 10}px`,
    '--dots-size': `${px}px`,
  }
  const dotVars: CssVars = { '--dot-color': color, '--dot-size': `${dot}px` }

  return (
    <span
      className={cn(
        'relative flex size-(--dots-size) items-center justify-center gap-(--dots-gap)',
        className
      )}
      style={loaderVars}>
      {DOTS.map((i) => (
        <motion.span
          key={i}
          className='size-(--dot-size) rounded-full bg-(--dot-color)'
          style={dotVars}
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
