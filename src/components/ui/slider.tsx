'use client'

import * as SliderPrimitive from '@radix-ui/react-slider'
import * as React from 'react'

import { fractionAcross, pageTurned } from '@/lib/page-turn'
import type { CssVars } from '@/types'
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

// How the slider looks. `block`: the panels' slider, a slim 4px line and a 16px knob (20px to a finger). `seek`: a player's seek line, as
// YouTube's: 3px, a little thicker under the pointer, with a small dot that shows only while the pointer is over
// it, the keyboard is on it or it is dragged (always, on a touch screen). `volume`: YouTube's volume line, 3px of
// white with a small white knob that always shows. The thin ones keep a tall box, so they are as easy to hit
type SliderLook = 'block' | 'seek' | 'volume'

const LOOKS: Record<
  SliderLook,
  { track: string; range: string; thumb: string }
> = {
  block: {
    range: 'bg-primary',
    thumb:
      'size-4 bg-foreground shadow-sm transition-transform active:scale-110 touch:size-5',
    track:
      "data-[orientation='horizontal']:h-1 data-[orientation='horizontal']:w-full",
  },
  seek: {
    range: 'bg-primary',
    thumb:
      'size-3 bg-primary opacity-0 transition-opacity duration-150 group-hover/slider:opacity-100 group-active/slider:opacity-100 focus-visible:opacity-100 touch:size-3.5 touch:opacity-100',
    track:
      "transition-[height] duration-150 data-[orientation='horizontal']:h-0.75 data-[orientation='horizontal']:w-full group-hover/slider:data-[orientation='horizontal']:h-1.25 touch:data-[orientation='horizontal']:h-1",
  },
  volume: {
    range: 'bg-white',
    thumb: 'size-3 bg-white',
    track:
      "data-[orientation='horizontal']:h-0.75 data-[orientation='horizontal']:w-full",
  },
}

const SliderRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    look?: SliderLook
    // Shown above the pointer while a mouse is over the slider (or drags it), as YouTube's seek time: a finger
    // covers the spot, so touch shows none
    hoverLabel?: (value: number) => React.ReactNode
    // What a screen reader says for the value ("1:12 of 3:45"), in place of the bare number
    valueText?: (value: number) => string
  }
> = (
  {
    className,
    onPointerDown,
    onPointerMove,
    onPointerLeave,
    look = 'block',
    hoverLabel,
    valueText,
    min = 0,
    max = 100,
    'aria-label': ariaLabel,
    ...props
  },
  ref
) => {
  const [hovered, setHovered] = React.useState<number | null>(null)
  const hoverVars: CssVars = {
    // Kept 1.5rem from the slider's ends, so the label never runs past them
    '--hover-at': `clamp(1.5rem, ${(hovered ?? 0) * 100}%, 100% - 1.5rem)`,
  }
  return (
    <SliderPrimitive.Root
      ref={ref}
      min={min}
      max={max}
      onPointerDown={(event) => {
        alongTurnedPage(event)
        onPointerDown?.(event)
      }}
      onPointerMove={(event) => {
        alongTurnedPage(event)
        if (hoverLabel && event.pointerType === 'mouse') {
          setHovered(
            Math.min(1, Math.max(0, fractionAcross(event, event.currentTarget)))
          )
        }
        onPointerMove?.(event)
      }}
      onPointerLeave={(event) => {
        setHovered(null)
        onPointerLeave?.(event)
      }}
      className={cn(
        'group/slider relative flex touch-none select-none',
        "data-[orientation='horizontal']:h-2 data-[orientation='horizontal']:w-full data-[orientation='horizontal']:items-center touch:data-[orientation='horizontal']:h-8",
        // Later in the list, so it wins over the h-2 above (tailwind-merge)
        look !== 'block' && "data-[orientation='horizontal']:h-4",
        "data-[orientation='vertical']:h-full data-[orientation='vertical']:w-2 data-[orientation='vertical']:justify-center",
        className
      )}
      {...props}>
      <SliderPrimitive.Track
        className={cn(
          'relative grow overflow-hidden rounded-full bg-white/25',
          LOOKS[look].track,
          "data-[orientation='vertical']:h-full data-[orientation='vertical']:w-2"
        )}>
        <SliderPrimitive.Range
          className={cn(
            'absolute',
            LOOKS[look].range,
            "data-[orientation='horizontal']:h-full",
            "data-[orientation='vertical']:w-full"
          )}
        />
      </SliderPrimitive.Track>
      {/* The thumb is the element with role="slider", so it carries the name; on the root it names nothing */}
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-valuetext={
          valueText && props.value?.[0] !== undefined
            ? valueText(props.value[0])
            : undefined
        }
        className={cn(
          'block rounded-full shadow-md ring-offset-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50',
          LOOKS[look].thumb
        )}
      />
      {hoverLabel && hovered !== null && (
        <span
          aria-hidden
          style={hoverVars}
          className='pointer-events-none absolute bottom-full left-(--hover-at) mb-1.5 -translate-x-1/2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs whitespace-nowrap text-white tabular-nums'>
          {hoverLabel(min + hovered * (max - min))}
        </span>
      )}
    </SliderPrimitive.Root>
  )
}
const Slider = React.forwardRef(SliderRender)
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
