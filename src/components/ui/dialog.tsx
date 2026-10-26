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

// In the middle of the screen: it grows a little from its own centre and never starts off the screen (shadcn's
// slide-ins add to the centring translate in Tailwind 4, starting it half a dialog to the left and above)
const CENTRED =
  'top-[50%] left-[50%] max-h-[calc(var(--app-h)-2rem-var(--safe-top)-var(--safe-bottom))] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-2xl p-6 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'

const dialogContentVariants = cva('', {
  defaultVariants: { variant: 'default' },
  variants: {
    variant: {
      // Edge to edge: the content lays out its own padding
      bare: cn(CENTRED, 'gap-0 p-0'),
      default: CENTRED,
      // Settings that change what's behind them as they're set (docs/private research, AGENTS.md › "Sheets,
      // dialogs and panels"): a sheet that leaves it in view, undimmed. On a tall screen it rises from the bottom
      // edge, 45% of the screen high at most (20rem on a small phone), so two lyric lines stay in view above it on the watch page, and no wider than a dialog; on a short one (a phone on its side,
      // or a page turned by Lock Landscape) it runs down the trailing edge, so the stage stays in view beside it.
      // Its surface runs under the safe areas; its content stays out of them. The content lays out its own padding
      sheet:
        'inset-x-0 bottom-0 mx-auto flex max-h-[max(calc(var(--app-h)*0.45),20rem)] w-full max-w-lg flex-col gap-0 overflow-y-hidden rounded-t-2xl p-0 pb-(--safe-bottom) data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom motion-reduce:data-[state=closed]:slide-out-to-bottom-0 motion-reduce:data-[state=closed]:slide-out-to-right-0 motion-reduce:data-[state=open]:slide-in-from-bottom-0 motion-reduce:data-[state=open]:slide-in-from-right-0 short:top-0 short:right-0 short:left-auto short:mx-0 short:h-full short:max-h-none short:w-[min(calc(22rem+var(--safe-right)),50%)] short:rounded-t-none short:rounded-l-2xl short:pt-(--safe-top) short:pr-(--safe-right) short:data-[state=closed]:slide-out-to-bottom-0 short:data-[state=closed]:slide-out-to-right short:data-[state=open]:slide-in-from-bottom-0 short:data-[state=open]:slide-in-from-right',
    },
  },
})

const dialogCloseVariants = cva(
  'absolute rounded-xs p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground touch:p-2.5',
  {
    defaultVariants: { variant: 'default' },
    variants: {
      variant: {
        bare: 'top-5 right-3 touch:top-3.5 touch:right-2',
        default: 'top-5 right-3 touch:top-3.5 touch:right-2',
        // In the sheet's own corner, clear of the safe areas its surface runs under; a 44px target on touch
        sheet:
          'top-1.5 right-1.5 touch:p-3.5 short:top-[calc(var(--safe-top)+0.375rem)] short:right-[calc(var(--safe-right)+0.375rem)]',
      },
    },
  }
)

const DialogContentRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    VariantProps<typeof dialogContentVariants>
> = (
  { className, children, variant, onOpenAutoFocus, onTouchMove, ...props },
  ref
) => (
  <DialogPortal>
    {/* A sheet leaves what it changes in view: its overlay only takes the tap that closes it */}
    <DialogOverlay
      className={variant === 'sheet' ? 'bg-transparent' : undefined}
    />
    {/* On a touch screen the dialog takes focus itself, not its first field: a keyboard rising as it opens pans
        the page under it */}
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
        'fixed z-50 grid gap-4 overflow-y-auto overscroll-contain bg-popover shadow-panel duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        dialogContentVariants({ variant }),
        className
      )}
      {...props}>
      {children}
      <DialogPrimitive.Close className={dialogCloseVariants({ variant })}>
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
