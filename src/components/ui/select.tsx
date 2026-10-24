import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/utils/cn'

// A native select, for the phone's own picker and the keyboard, with our chevron in place of the browser's. The
// browser draws its arrow a fixed few pixels from the edge, ignoring padding and radius, so on a pill it sits in
// the curve. The chevron's drawing (4px in from its box) ends one corner radius from the edge, in the straight
// part, centred on the text; the right padding stops a long value before it. The dark scheme
// and option colours keep Windows' popup from drawing our light text on white
const selectVariants = cva(
  'w-full min-w-0 appearance-none truncate border border-input bg-card text-foreground scheme-dark transition-colors hover:border-foreground/60 disabled:cursor-not-allowed [&_option]:bg-popover [&_option]:text-popover-foreground',
  {
    defaultVariants: { size: 'default' },
    variants: {
      size: {
        // Radius 18: the drawing ends at 14 + 4. The value starts 16px in, as far as the chevron ends
        default: 'h-9 rounded-full pr-9 pl-4 text-sm',
        // Radius 6: the drawing ends at 4 + 4, clear of the corner
        sm: 'h-8 rounded-md pr-7 pl-2 text-sm',
      },
    },
  }
)

const chevronVariants = cva(
  'pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground',
  {
    defaultVariants: { size: 'default' },
    variants: {
      size: {
        default: 'right-3.5',
        sm: 'right-1',
      },
    },
  }
)

// `className` places and sizes the field (its width, a max-width); the select fills it
type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> &
  VariantProps<typeof selectVariants>

const SelectRender: React.ForwardRefRenderFunction<
  HTMLSelectElement,
  SelectProps
> = ({ className, size, children, ...props }, ref) => (
  <div
    className={cn(
      'relative inline-flex min-w-0 has-disabled:opacity-50',
      className
    )}>
    <select ref={ref} className={selectVariants({ size })} {...props}>
      {children}
    </select>
    <ChevronDownIcon className={chevronVariants({ size })} aria-hidden />
  </div>
)
const Select = React.forwardRef(SelectRender)
Select.displayName = 'Select'

export { Select }
