import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import * as React from 'react'

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
      default: '',
      // A floating card that lays out its own padding
      floating: 'rounded-[10px] p-0 shadow-[0_12px_32px_rgb(0_0_0/0.5)]',
      // A floating card that grows out of its trigger and shrinks back into it. The owner aims it by setting
      // --trigger-origin (the trigger's centre in the card's box); unset, it uses Radix's corner
      'floating-tucked':
        'origin-(--trigger-origin,var(--radix-popover-content-transform-origin)) rounded-[10px] p-0 shadow-[0_12px_32px_rgb(0_0_0/0.5)] data-[state=closed]:animate-into-trigger',
    },
  },
})

const PopoverContent = ({
  className,
  align = 'center',
  sideOffset = 4,
  variant,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> &
  VariantProps<typeof popoverContentVariants>) => (
  <PopoverPrimitive.Portal>
    {/* Opens in 200ms, fading in and settling 4px (only fading with reduced motion); fades out in 150ms. No zoom:
        scaling a large card moves its far edge tens of pixels */}
    <PopoverPrimitive.Content
      data-slot='popover-content'
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-xl bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=closed]:ease-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:duration-200 data-[state=open]:ease-[cubic-bezier(0.2,0,0,1)] data-[state=open]:fade-in-0 motion-safe:data-[side=bottom]:slide-in-from-top-1 motion-safe:data-[side=left]:slide-in-from-right-1 motion-safe:data-[side=right]:slide-in-from-left-1 motion-safe:data-[side=top]:slide-in-from-bottom-1',
        popoverContentVariants({ variant }),
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
)

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
