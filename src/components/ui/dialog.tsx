'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import * as React from 'react'

import { keepScrollWhenTurned } from '@/lib/page-turn'
import { cn } from '@/utils/cn'

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlayRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
> = ({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/75 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
)
const DialogOverlay = React.forwardRef(DialogOverlayRender)
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const dialogContentVariants = cva('', {
  defaultVariants: { variant: 'default' },
  variants: {
    variant: {
      // Edge to edge: the content lays out its own padding
      bare: 'gap-0 p-0',
      default: '',
    },
  },
})

const DialogContentRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    VariantProps<typeof dialogContentVariants>
> = (
  { className, children, variant, onOpenAutoFocus, onTouchMove, ...props },
  ref
) => (
  <DialogPortal>
    <DialogOverlay />
    {/* Opens in place: it grows a little from its own centre and never starts off the screen (shadcn's slide-ins
        add to the centring translate in Tailwind 4, starting it half a dialog to the left and above). On a
        touch screen the dialog takes focus itself, not its first field: a keyboard rising as it opens pans the
        page under it */}
    <DialogPrimitive.Content
      ref={ref}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event)
        if (
          !event.defaultPrevented &&
          matchMedia('(pointer: coarse)').matches
        ) {
          event.preventDefault()
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus({ preventScroll: true })
          }
        }
      }}
      onTouchMove={(event) => {
        onTouchMove?.(event)
        keepScrollWhenTurned(event)
      }}
      className={cn(
        'fixed top-[50%] left-[50%] z-50 grid max-h-[calc(var(--app-h)-2rem-var(--safe-top)-var(--safe-bottom))] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain rounded-2xl bg-popover p-6 shadow-panel duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        dialogContentVariants({ variant }),
        className
      )}
      {...props}>
      {children}
      <DialogPrimitive.Close className='absolute top-5 right-3 rounded-xs p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground touch:top-3.5 touch:right-2 touch:p-2.5'>
        <X className='h-4 w-4' />
        <span className='sr-only'>Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
)
const DialogContent = React.forwardRef(DialogContentRender)
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col gap-1.5 text-center sm:text-left', className)}
    {...props}
  />
)
DialogHeader.displayName = 'DialogHeader'

const dialogFooterVariants = cva('', {
  defaultVariants: { gap: 'default' },
  variants: {
    // Space between buttons when they stack on a narrow screen
    gap: {
      default: '',
      md: 'gap-2',
    },
  },
})

const DialogFooter = ({
  className,
  gap,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof dialogFooterVariants>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2',
      dialogFooterVariants({ gap }),
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const dialogTitleVariants = cva('', {
  defaultVariants: { size: 'default' },
  variants: {
    size: {
      default: '',
      sm: 'text-base font-semibold',
    },
  },
})

const DialogTitleRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> &
    VariantProps<typeof dialogTitleVariants>
> = ({ className, size, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg leading-none font-semibold tracking-tight',
      dialogTitleVariants({ size }),
      className
    )}
    {...props}
  />
)
const DialogTitle = React.forwardRef(DialogTitleRender)
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescriptionRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
> = ({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
)
const DialogDescription = React.forwardRef(DialogDescriptionRender)
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
