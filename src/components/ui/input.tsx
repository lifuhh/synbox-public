import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/utils/cn'

const inputVariants = cva('', {
  defaultVariants: { state: 'default', variant: 'default' },
  variants: {
    // The border tells whether what was typed is usable
    state: {
      default: '',
      empty:
        'border-foreground/60 hover:border-foreground/80 focus:border-foreground/90',
      invalid:
        'border-error-input hover:border-foreground focus:border-error-input',
      valid: 'border-success hover:border-foreground focus:border-success',
    },
    variant: {
      default: '',
      // The landing page's big search box
      hero: 'border-2 bg-input/40 py-6 text-white invisible-ring',
    },
  },
})

type InputProps = React.InputHTMLAttributes<HTMLInputElement> &
  VariantProps<typeof inputVariants>

const InputRender: React.ForwardRefRenderFunction<
  HTMLInputElement,
  InputProps
> = ({ className, type, variant, state, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm touch:text-base',
      inputVariants({ state, variant }),
      className
    )}
    ref={ref}
    {...props}
  />
)
const Input = React.forwardRef(InputRender)
Input.displayName = 'Input'

export { Input }
