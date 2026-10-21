import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/utils/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium whitespace-nowrap ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      // Space between an icon and its label
      gap: {
        md: 'gap-2',
        sm: 'gap-1.5',
      },
      size: {
        default: 'h-10 px-4 py-2',
        icon: 'h-10 w-10',
        // A small round icon button, as for a carousel's arrows
        'icon-round': 'size-9 rounded-full',
        // The action inside a field, as the landing search box's
        inset: 'h-11 px-5',
        lg: 'h-11 rounded-md px-8',
        // A default-height button with a little side padding, for a lone icon in a row
        narrow: 'h-10 px-2 py-2',
        sm: 'h-9 rounded-md px-3',
        // The hero's call to action: padding, not height, sets how tall it is
        tall: 'h-10 px-4 py-6',
      },
      variant: {
        // The one main action on a view: a tonal pill that stands out without glaring
        default:
          'bg-primary-subtle text-primary-text hover:bg-primary-subtle-hover',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        // Ghost that takes the tonal fill on hover
        'ghost-primary': 'hover:bg-primary-subtle hover:text-primary-text',
        // Ghost with dimmed text that brightens on hover
        'ghost-subtle':
          'text-accent-foreground hover:bg-accent hover:text-foreground',
        // The landing search box's action, sitting inside the field
        hero: 'rounded-full bg-primary-subtle font-semibold text-primary-text hover:bg-primary-subtle-hover',
        link: 'text-primary-text underline-offset-4 hover:underline',
        // A secondary action: a neutral fill, no outline
        outline: 'bg-secondary hover:bg-accent hover:text-accent-foreground',
        // Ghost buttons on the dark glass of a floating panel
        overlay: 'text-white/80 hover:bg-white/10 hover:text-accent-foreground',
        'overlay-icon':
          'rounded-full text-white/70 hover:bg-white/10 hover:text-white',
        'overlay-muted': 'text-white/60 hover:bg-white/10 hover:text-white',
        // A floating panel's ghost button with an outline, for a second action beside a filled one
        'overlay-outline':
          'border border-white/20 text-white/90 hover:border-white/35 hover:bg-white/10 hover:text-white',
        // A play button in a song list: a quiet icon that lights up on hover
        'row-icon':
          'rounded-full text-muted-foreground hover:bg-accent hover:text-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        // The top bar's icon buttons
        toolbar: 'rounded-full hover:bg-accent hover:text-accent-foreground',
      },
    },
  }
)

interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const ButtonRender: React.ForwardRefRenderFunction<
  HTMLButtonElement,
  ButtonProps
> = ({ className, variant, size, gap, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ className, gap, size, variant }))}
      ref={ref}
      {...props}
    />
  )
}
const Button = React.forwardRef(ButtonRender)
Button.displayName = 'Button'

export { Button, buttonVariants }
