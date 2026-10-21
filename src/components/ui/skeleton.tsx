import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/utils/cn'

const skeletonVariants = cva('', {
  defaultVariants: { shape: 'default' },
  variants: {
    // Matches the corners of what is loading
    shape: {
      card: 'rounded-xl',
      default: '',
      thumbnail: 'rounded-lg',
    },
  },
})

const Skeleton = ({
  className,
  shape,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof skeletonVariants>) => (
  <div
    data-slot='skeleton'
    className={cn(
      'skeleton-shimmer rounded-md skeleton-fill',
      skeletonVariants({ shape }),
      className
    )}
    {...props}
  />
)

export { Skeleton }
