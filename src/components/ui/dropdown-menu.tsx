'use client'

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/utils/cn'

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const dropdownMenuItemVariants = cva('', {
  defaultVariants: { variant: 'default' },
  variants: {
    variant: {
      default: '',
      // An action that can't be taken back lightly, such as blocking someone
      destructive: 'text-error focus:text-error',
      // A quiet line under the call to action, as the guest's privacy note
      note: 'justify-center py-0.5 text-center text-xs text-balance text-muted-foreground focus:bg-transparent focus:text-foreground',
      // The menu's one call to action, as a guest's Continue With Google: a tonal pill
      primary:
        'justify-center rounded-full bg-primary-subtle py-2 font-semibold text-primary-text focus:bg-primary-subtle-hover focus:text-primary-text',
      // A label over a line of description
      stacked: 'flex-col items-start gap-0.5',
    },
  },
})

const DropdownMenuContentRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
> = ({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-32 overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
)
const DropdownMenuContent = React.forwardRef(DropdownMenuContentRender)
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItemRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> &
    VariantProps<typeof dropdownMenuItemVariants> & {
      inset?: boolean
    }
> = ({ className, inset, variant, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    // rounded-lg: the menu's 12px corners less its 4px padding, so a highlighted row nests in them
    className={cn(
      'relative flex cursor-default items-center rounded-lg px-2 py-1.5 text-sm outline-hidden transition-colors select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
      inset === true && 'pl-8',
      dropdownMenuItemVariants({ variant }),
      className
    )}
    {...props}
  />
)
const DropdownMenuItem = React.forwardRef(DropdownMenuItemRender)
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuSeparatorRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
> = ({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-muted', className)}
    {...props}
  />
)
const DropdownMenuSeparator = React.forwardRef(DropdownMenuSeparatorRender)
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
}
