'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/utils/cn'

const TooltipProvider = TooltipPrimitive.Provider

// A touch screen has no hover to close a tooltip, and a menu returning focus to its trigger would
// open one that then never leaves. Uncontrolled tooltips stay closed there; a controlled one decides
const Tooltip = ({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) => {
  const touch = useMediaQuery('(pointer: coarse)')
  // Always controlled, so a change of input device never flips it between modes
  const [hovered, setHovered] = React.useState(false)
  return (
    <TooltipPrimitive.Root
      open={open ?? (!touch && hovered)}
      onOpenChange={(next) => {
        setHovered(next)
        onOpenChange?.(next)
      }}
      {...props}
    />
  )
}

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  // Rendered inline, the content joins its trigger's parent layout (gaps,
  // space-y margins) and shifts it
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-999 animate-in overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
