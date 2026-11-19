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
      // A resting card on a page (the versions list): the soft 16px of DESIGN.md §5
      panel: 'rounded-2xl',
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
