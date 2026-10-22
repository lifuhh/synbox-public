'use client'

import * as SliderPrimitive from '@radix-ui/react-slider'
import * as React from 'react'

import { fractionAcross, pageTurned } from '@/lib/page-turn'
import { cn } from '@/utils/cn'

// Radix places the value by the pointer's clientX across the slider's box on screen. On a page turned by
// Lock Landscape the slider runs down the screen instead, so the position along it is rewritten into the
// clientX Radix reads, before its own handler runs
const alongTurnedPage = (event: React.PointerEvent<HTMLSpanElement>) => {
  if (!pageTurned()) {
    return
  }
  const box = event.currentTarget.getBoundingClientRect()
  event.clientX =
    box.left + box.width * fractionAcross(event, event.currentTarget)
}

// `thin`: a player's seek line, as YouTube's: 3px, a little thicker under the pointer, with a small dot that shows
// only while the pointer is over it, the keyboard is on it or it is dragged (always, on a touch screen). The box
// stays tall, so the line is as easy to hit as before
const SliderRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    thin?: boolean
  }
> = (
  { className, onPointerDown, onPointerMove, thin = false, ...props },
  ref
) => (
  <SliderPrimitive.Root
    ref={ref}
    onPointerDown={(event) => {
      alongTurnedPage(event)
      onPointerDown?.(event)
    }}
    onPointerMove={(event) => {
      alongTurnedPage(event)
      onPointerMove?.(event)
    }}
    className={cn(
      'group/slider relative flex touch-none select-none',
      "data-[orientation='horizontal']:h-2 data-[orientation='horizontal']:w-full data-[orientation='horizontal']:items-center touch:data-[orientation='horizontal']:h-8",
      // Later in the list, so it wins over the h-2 above (tailwind-merge)
      thin && "data-[orientation='horizontal']:h-4",
      "data-[orientation='vertical']:h-full data-[orientation='vertical']:w-2 data-[orientation='vertical']:justify-center",
      className
    )}
    {...props}>
    <SliderPrimitive.Track
      className={cn(
        'relative grow overflow-hidden rounded-full bg-white/25',
        thin
          ? "transition-[height] duration-150 data-[orientation='horizontal']:h-0.75 data-[orientation='horizontal']:w-full group-hover/slider:data-[orientation='horizontal']:h-1.25 touch:data-[orientation='horizontal']:h-1"
          : "data-[orientation='horizontal']:h-2 data-[orientation='horizontal']:w-full",
        "data-[orientation='vertical']:h-full data-[orientation='vertical']:w-2"
      )}>
      <SliderPrimitive.Range
        className={cn(
          'absolute bg-primary',
          "data-[orientation='horizontal']:h-full",
          "data-[orientation='vertical']:w-full"
        )}
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        'block rounded-full shadow-md ring-offset-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50',
        thin
          ? 'size-3 bg-primary opacity-0 transition-opacity duration-150 group-hover/slider:opacity-100 group-active/slider:opacity-100 focus-visible:opacity-100 touch:size-3.5 touch:opacity-100'
          : 'h-5 w-5 bg-foreground transition-colors touch:h-6 touch:w-6'
      )}
    />
  </SliderPrimitive.Root>
)
const Slider = React.forwardRef(SliderRender)
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
