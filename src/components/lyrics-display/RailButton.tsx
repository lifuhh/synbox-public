import type { ComponentProps, ReactNode } from 'react'

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

export const RailTooltip = ({
  label,
  hidden = false,
  children,
}: {
  label: string
  hidden?: boolean
  children: ReactNode
}) => (
  <Tooltip open={hidden ? false : undefined}>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent
      side='right'
      sideOffset={10}
      className='border-none bg-primary text-white unhighlightable'>
      {label}
    </TooltipContent>
  </Tooltip>
)
