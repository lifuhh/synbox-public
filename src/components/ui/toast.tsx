'use client'

import * as ToastPrimitives from '@radix-ui/react-toast'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/utils/cn'

const ToastProvider = ToastPrimitives.Provider

const ToastViewportRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
> = ({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'fixed top-[calc(var(--topbar-h)+0.5rem+var(--notices-h,0px))] right-[max(1rem,var(--safe-right))] z-100 flex max-h-(--app-h) w-[calc(100%-2rem)] flex-col gap-2 sm:w-auto sm:max-w-sm',
      className
    )}
    {...props}
  />
)
const ToastViewport = React.forwardRef(ToastViewportRender)
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-xl py-2.5 pr-9 pl-3.5 shadow-md backdrop-blur-md transition-all data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-right-4 data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=end]:animate-out data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none touch:pr-11',
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default: 'bg-popover/90 text-popover-foreground',
        // Errors and refusals: a dark red surface with light red text, like the tonal buttons
        destructive: 'group bg-error-surface text-error-soft',
      },
    },
  }
)

const ToastRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
> = ({ className, variant, ...props }, ref) => (
  <ToastPrimitives.Root
    ref={ref}
    data-variant={variant ?? undefined}
    className={cn(toastVariants({ variant }), className)}
    {...props}
  />
)
const Toast = React.forwardRef(ToastRender)
Toast.displayName = ToastPrimitives.Root.displayName

const ToastActionRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
> = ({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-white/10 px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-white/15 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden focus:group-data-[variant=destructive]:ring-destructive disabled:pointer-events-none disabled:opacity-50 touch:h-10',
      className
    )}
    {...props}
  />
)
const ToastAction = React.forwardRef(ToastActionRender)
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastCloseRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
> = ({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-data-[variant=destructive]:text-error hover:text-foreground hover:group-data-[variant=destructive]:text-error-hover focus:opacity-100 focus:ring-2 focus:outline-hidden focus:group-data-[variant=destructive]:ring-error-border focus:group-data-[variant=destructive]:ring-offset-error-ring-offset touch:right-0 touch:p-2.5 touch:opacity-100',
      className
    )}
    toast-close=''
    {...props}>
    <X className='h-4 w-4' />
  </ToastPrimitives.Close>
)
const ToastClose = React.forwardRef(ToastCloseRender)
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitleRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
> = ({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-sm font-medium', className)}
    {...props}
  />
)
const ToastTitle = React.forwardRef(ToastTitleRender)
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescriptionRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
> = ({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-xs opacity-80', className)}
    {...props}
  />
)
const ToastDescription = React.forwardRef(ToastDescriptionRender)
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  type ToastActionElement,
  type ToastProps,
}
