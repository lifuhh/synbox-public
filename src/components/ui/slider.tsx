'use client'

import * as SliderPrimitive from '@radix-ui/react-slider'
import * as React from 'react'

import { cn } from '@/utils/cn'

const SliderRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
> = ({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
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
