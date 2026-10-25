'use client'

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import * as React from 'react'

import { buttonVariants } from '@/components/ui/button'
import { keepScrollWhenTurned } from '@/lib/page-turn'
import { cn } from '@/utils/cn'

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlayRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
> = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
      className
    )}
    {...props}
    ref={ref}
  />
)
const AlertDialogOverlay = React.forwardRef(AlertDialogOverlayRender)
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContentRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
> = ({ className, onTouchMove, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      onTouchMove={(event) => {
        onTouchMove?.(event)
        keepScrollWhenTurned(event)
      }}
      className={cn(
        'fixed top-[50%] left-[50%] z-50 grid max-h-[calc(var(--app-h)-2rem)] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-2xl bg-popover p-6 shadow-panel duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className
      )}
      {...props}
    />
  </AlertDialogPortal>
)
const AlertDialogContent = React.forwardRef(AlertDialogContentRender)
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
    {...props}
  />
)
AlertDialogHeader.displayName = 'AlertDialogHeader'

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2',
      className
    )}
    {...props}
  />
)
AlertDialogFooter.displayName = 'AlertDialogFooter'

const AlertDialogTitleRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
> = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold', className)}
    {...props}
  />
)
const AlertDialogTitle = React.forwardRef(AlertDialogTitleRender)
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescriptionRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
> = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
)
const AlertDialogDescription = React.forwardRef(AlertDialogDescriptionRender)
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

const AlertDialogActionRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
> = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants(), className)}
    {...props}
  />
)
const AlertDialogAction = React.forwardRef(AlertDialogActionRender)
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancelRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
> = ({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(
      buttonVariants({ variant: 'outline' }),
      'mt-2 sm:mt-0',
      className
    )}
    {...props}
  />
)
const AlertDialogCancel = React.forwardRef(AlertDialogCancelRender)
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
}
