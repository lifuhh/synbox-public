import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { FLOAT_MOTION, FLOAT_SURFACE } from '@/components/ui/float'
import '@/lib/turned-popper'
import { cn } from '@/utils/cn'

const Popover = ({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) => (
  <PopoverPrimitive.Root data-slot='popover' {...props} />
)

const PopoverTrigger = ({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) => (
  <PopoverPrimitive.Trigger data-slot='popover-trigger' {...props} />
)

const PopoverAnchor = ({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) => (
  <PopoverPrimitive.Anchor data-slot='popover-anchor' {...props} />
)

const popoverContentVariants = cva('', {
  defaultVariants: { variant: 'default' },
  variants: {
    variant: {
      // A short light pill beside its button, for a confirmation that must be noticed (Report Sent)
      callout:
        'flex w-auto items-center gap-1.5 rounded-full bg-callout py-1.5 ps-2.5 pe-3 text-sm font-medium whitespace-nowrap text-callout-foreground shadow-rail',
      default: '',
      // A floating card that lays out its own padding
      floating: 'p-0',
      // A floating card that grows out of its trigger and shrinks back into it. The owner aims it by setting
      // --trigger-origin (the trigger's centre in the card's box); unset, it uses Radix's corner
      'floating-tucked':
        'origin-(--trigger-origin,var(--radix-popover-content-transform-origin)) p-0 data-[state=closed]:animate-into-trigger',
    },
  },
})

const PopoverContent = ({
  className,
  align = 'center',
  sideOffset = 4,
  variant,
  container,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> &
  VariantProps<typeof popoverContentVariants> & {
    // Where it is drawn, when not at the end of the page: inside a full-screen layer of its own (the reader), so it
    // takes that layer's colours
    container?: HTMLElement | null
  }) => (
  <PopoverPrimitive.Portal container={container}>
    <PopoverPrimitive.Content
      data-slot='popover-content'
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 origin-(--radix-popover-content-transform-origin) p-4 outline-hidden',
        FLOAT_SURFACE,
        FLOAT_MOTION,
        popoverContentVariants({ variant }),
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
)

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
