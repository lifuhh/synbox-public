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
      search: 'border-search hover:border-foreground focus:border-search',
      valid: 'border-success hover:border-foreground focus:border-success',
    },
    variant: {
      // Borderless inside an InputField, which draws the edge and its state. `data-clearing`: its text fades out
      // before the field empties (the hero's link once its song started)
      bare: 'h-12 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-base text-foreground invisible-ring transition-opacity duration-150 ease-out data-clearing:opacity-0 sm:text-base',
      default: '',
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
      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm touch:text-base',
      inputVariants({ state, variant }),
      className
    )}
    ref={ref}
    {...props}
  />
)
const Input = React.forwardRef(InputRender)
Input.displayName = 'Input'

// A rounded field that holds a bare Input and an action. The border tells whether what was typed is
// usable, as on Input, but reacts to focus anywhere inside the field. The 50px field holds a 40px action
// 4px in from the border on every side, so both pills share a centre (radius 25 = 20 + 4 + 1)
const inputFieldVariants = cva(
  'flex w-full items-center gap-2 rounded-full border bg-card pr-1 pl-5 transition-colors',
  {
    defaultVariants: { state: 'default' },
    variants: {
      state: {
        default:
          'border-input focus-within:border-foreground/80 hover:border-foreground/60',
        empty:
          'border-foreground/60 focus-within:border-foreground/90 hover:border-foreground/80',
        invalid:
          'border-error-input focus-within:border-error-input hover:border-foreground',
        search:
          'border-search focus-within:border-search hover:border-foreground',
        valid:
          'border-success focus-within:border-success hover:border-foreground',
      },
    },
  }
)

const InputField = ({
  className,
  state,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputFieldVariants>) => (
  // data-focus-field: keyboard focus on the input inside draws the shared indicator on this frame (globals.css)
  <div
    data-focus-field
    className={cn(inputFieldVariants({ state }), className)}
    {...props}
  />
)

export { Input, InputField }
