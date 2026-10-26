import type { ComponentProps, ReactNode } from 'react'
import { createContext, use, useState } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/utils/cn'

interface RailButtonProps extends ComponentProps<'button'> {
  label: string
  // Set for toggles: filled while on, dimmed while off
  pressed?: boolean
}

// A button floating on the stage: the rail's and the corner column's, one size and look everywhere
export const STAGE_DISC =
  'grid size-10 shrink-0 place-items-center rounded-full bg-black/55 text-white/90 shadow-rail backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white disabled:pointer-events-none disabled:opacity-30 touch:size-11 short:size-9'

// Set when the rail is a row under the video on the watch page: its labels and panels open above or below
// it instead of to its side
export const RailInline = createContext(false)

// Floating on the stage, a dark glass disc of its own, as the stage's centre and Previous/Next buttons are (no
// panel behind the rail: owner, 2026-10-25). Inline under the video, a round button of its own, spaced from the
// next, as YouTube's row under a video is
const railButtonClass = (inline: boolean, pressed: boolean | undefined) =>
  inline
    ? cn(
        'grid size-10 shrink-0 place-items-center rounded-full bg-card text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30 watch-narrow:w-full',
        pressed === true &&
          'bg-primary-subtle text-primary-text hover:bg-primary-subtle-hover',
        pressed === false && 'text-muted-foreground'
      )
    : cn(
        STAGE_DISC,
        pressed === true &&
          'bg-primary-subtle text-primary-text hover:bg-primary-subtle-hover',
        // On the disc's glass over a white frame, the brightest video
        pressed === false && 'text-white/70'
      )

export const RailButton = ({
  label,
  pressed,
  className,
  ...props
}: RailButtonProps) => (
  <button
    type='button'
    aria-label={label}
    aria-pressed={pressed}
    className={cn(railButtonClass(use(RailInline), pressed), className)}
    {...props}
  />
)

// Set while the rail's style panel is open: it covers the space the tooltips open into
export const RailTooltipsOff = createContext(false)

export const RailTooltip = ({
  label,
  hidden = false,
  children,
}: {
  label: string
  hidden?: boolean
  children: ReactNode
}) => {
  // Labels are for hover; on a touch screen they would only cover the stage
  const touch = useMediaQuery('(pointer: coarse)')
  const off = hidden || touch || use(RailTooltipsOff)
  const inline = use(RailInline)
  // Controlled, and closed while off, so a tooltip never reopens from state it had before
  const [open, setOpen] = useState(false)
  const [wasOff, setWasOff] = useState(off)
  if (off !== wasOff) {
    setWasOff(off)
    setOpen(false)
  }
  return (
    <Tooltip
      open={open && !off}
      onOpenChange={(next) => {
        if (!off) {
          setOpen(next)
        }
      }}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={inline ? 'top' : 'right'} sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

// Where a rail button's panel or menu opens: above the watch page's row (Radix turns it below only when there is no
// room above), below the phone's rail, beside the stage's rail. One rule, so every panel of the row opens alike
export const railMenuSide = (
  inline: boolean,
  portrait: boolean
): 'top' | 'bottom' | 'right' => {
  if (inline) {
    return 'top'
  }
  return portrait ? 'bottom' : 'right'
}
