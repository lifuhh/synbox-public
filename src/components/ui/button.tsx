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
        lg: 'h-11 rounded-md px-8',
        // A default-height button with a little side padding, for a lone icon in a row
        narrow: 'h-10 px-2 py-2',
        sm: 'h-9 rounded-md px-3',
        // The hero's call to action: padding, not height, sets how tall it is
        tall: 'h-10 px-4 py-6',
      },
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        // Ghost that fills with the brand color on hover
        'ghost-primary': 'hover:bg-primary hover:text-accent-foreground',
        // Ghost with dimmed text that brightens on hover
        'ghost-subtle':
          'text-accent-foreground hover:bg-accent hover:text-foreground',
        // Raised hero call to action
        hero: 'border-2 border-primary/90 bg-primary/90 text-foreground hover:border-primary hover:bg-primary',
        // White pill on a brand-colored card; solid brand text, as 80% falls under 4.5:1 contrast on white
        inverse:
          'rounded-xl bg-white font-bold text-primary hover:bg-primary/80 hover:text-foreground [&:hover]:transition-none [&:hover]:duration-0',
        link: 'text-primary underline-offset-4 hover:bg-primary hover:text-white hover:underline',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        // The top bar's icon buttons
        'outline-primary':
          'border border-primary/80 bg-background invisible-ring hover:border-white hover:bg-accent hover:text-accent-foreground',
        // Ghost buttons on the dark glass of a floating panel
        overlay: 'text-white/80 hover:bg-white/10 hover:text-accent-foreground',
        'overlay-icon':
          'rounded-full text-white/70 hover:bg-white/10 hover:text-white',
        'overlay-muted': 'text-white/60 hover:bg-white/10 hover:text-white',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        // A play button in a song list: a link-styled icon on a filled square
        'secondary-link':
          'bg-secondary text-primary underline-offset-4 hover:bg-primary hover:text-white hover:underline',
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
