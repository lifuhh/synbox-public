import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/utils/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium whitespace-nowrap ring-offset-background transition duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 motion-safe:enabled:active:scale-96',
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
        default: 'h-10 label-icons px-4 py-2',
        icon: 'h-10 w-10',
        // A small round icon button, as for a carousel's arrows
        'icon-round': 'size-9 rounded-full',
        // The action inside a field, as the landing search box's. A trailing icon's drawing starts inside its
        // box, so that side's padding is 4px less and the label and icon sit the same distance from the edges
        inset: 'h-10 label-icons px-5 has-[>svg]:pr-4',
        lg: 'h-11 label-icons rounded-md px-8',
        // A short labelled pill that sits among the top bar's icon buttons
        pill: 'h-9 label-icons rounded-full px-3 sm:px-4',
        // A labelled pill that keeps only its icon under 360px wide, where the top bar has no room for the word
        'pill-collapse':
          'h-9 rounded-full px-3 max-[359px]:w-9 max-[359px]:px-0 min-[360px]:label-icons sm:px-4',
        // A slim labelled action at the end of a list row, as the notifications panel's Play. A leading icon's
        // drawing starts inside its box, so that side's padding is 2px less
        row: 'h-7 label-icons gap-1 rounded-md pr-2.5 pl-2',
        sm: 'h-9 label-icons rounded-md px-3',
        // The hero's call to action: padding, not height, sets how tall it is
        tall: 'h-10 label-icons px-4 py-6',
        // A quiet text action, as a panel's Reset: drawn 32px, its press area 44px on touch, reaching only above
        // and below so neighbours side by side keep their gap
        text: "relative h-8 label-icons rounded-md px-2 touch:after:absolute touch:after:inset-x-0 touch:after:-inset-y-1.5 touch:after:content-['']",
      },
      variant: {
        // The one main action on a view: a tonal pill that stands out without glaring
        default:
          'bg-primary-subtle text-primary-text hover:bg-primary-subtle-hover',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
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
        // Muted text, no fill or border until hovered: an action that should not draw the eye
        quiet: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        // A play button in a song list: a quiet icon that lights up on hover
        'row-icon':
          'rounded-full text-muted-foreground hover:bg-accent hover:text-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        // A dialog's one action in neutral high contrast (Continue With Google, Send): near-white on the dark sheet
        solid: 'bg-foreground text-background hover:bg-foreground/90',
        // A round icon button over content (the watch page's lyrics), filled so the lines under it don't show
        // through
        'surface-icon':
          'rounded-full bg-secondary hover:bg-accent hover:text-accent-foreground',
        // The top bar's icon buttons
        // A button that stays on (aria-pressed), as a playlist's Shuffle: on, it takes the brand colour
        toggle:
          'rounded-full hover:bg-accent hover:text-accent-foreground aria-pressed:bg-primary-subtle aria-pressed:text-primary-text aria-pressed:hover:bg-primary-subtle-hover',
        toolbar: 'rounded-full hover:bg-accent hover:text-accent-foreground',
        // A labelled top-bar button among the icon buttons, outlined: Sign In with Google, whose branding keeps a
        // visible boundary (its dark theme: a 1px line on a dark fill)
        'toolbar-outline':
          'rounded-full border border-input hover:bg-accent hover:text-accent-foreground',
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
