import type { ComponentProps, ReactNode } from 'react'
import { createContext, use, useState } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/utils/cn'

interface RailButtonProps extends ComponentProps<'button'> {
  label: string
  // Set for toggles: filled while on, dimmed while off
  pressed?: boolean
}

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
    className={cn(
      'grid size-9 place-items-center rounded-lg text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30',
      pressed === true && 'bg-primary text-white hover:bg-primary/85',
      pressed === false && 'text-white/45',
      className
    )}
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
  const off = hidden || use(RailTooltipsOff)
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
      <TooltipContent
        side='right'
        sideOffset={10}
        className='border-none bg-primary text-white unhighlightable'>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
