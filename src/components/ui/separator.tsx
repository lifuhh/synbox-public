'use client'

import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/utils/cn'

const separatorVariants = cva('', {
  defaultVariants: { variant: 'default' },
  variants: {
    variant: {
      // Brand-colored rule under a page heading
      brand: 'bg-brand-divider',
      // Full-strength rule between footer columns
      contrast: 'bg-foreground',
      default: '',
      // Gray rule either side of a section label
      muted: 'bg-divider',
    },
  },
})

const SeparatorRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> &
    VariantProps<typeof separatorVariants>
> = (
  {
    className,
    orientation = 'horizontal',
    decorative = true,
    variant,
    ...props
  },
  ref
) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-border',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      separatorVariants({ variant }),
      className
    )}
    {...props}
  />
)
const Separator = React.forwardRef(SeparatorRender)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
