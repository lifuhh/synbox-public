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

const SliderRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
> = ({ className, onPointerDown, onPointerMove, ...props }, ref) => (
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
      'relative flex touch-none select-none',
      "data-[orientation='horizontal']:h-2 data-[orientation='horizontal']:w-full data-[orientation='horizontal']:items-center touch:data-[orientation='horizontal']:h-8",
      "data-[orientation='vertical']:h-full data-[orientation='vertical']:w-2 data-[orientation='vertical']:justify-center",
      className
    )}
    {...props}>
    <SliderPrimitive.Track
      className={cn(
        'relative grow overflow-hidden rounded-full bg-white/25',
        "data-[orientation='horizontal']:h-2 data-[orientation='horizontal']:w-full",
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
    <SliderPrimitive.Thumb className='block h-5 w-5 rounded-full bg-foreground shadow-md ring-offset-accent-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 touch:h-6 touch:w-6' />
  </SliderPrimitive.Root>
)
const Slider = React.forwardRef(SliderRender)
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
