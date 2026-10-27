'use client'

import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as React from 'react'

import { cn } from '@/utils/cn'

const Tabs = TabsPrimitive.Root

const TabsListRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    // For compact tabs (TabsTrigger `compact`): 8px between them on touch, so adjacent press targets keep apart
    compact?: boolean
  }
> = ({ className, compact = false, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-10 items-center justify-center gap-1 rounded-full bg-muted p-1 text-muted-foreground',
      compact && 'touch:gap-2',
      className
    )}
    {...props}
  />
)
const TabsList = React.forwardRef(TabsListRender)
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTriggerRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    // Tabs that must sit side by side on a phone (Library's four fit a 390px screen): half the side padding on touch,
    // and a press target that reaches past the list's 4px inset to the full row height
    compact?: boolean
  }
> = ({ className, compact = false, onMouseDown, onClick, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    // A tab is chosen on release, inside it, not on the press Radix uses: a press that slides off chooses nothing
    // (docs/private/2026-10-26-activation-timing-research.md). The click focuses it, and Radix's automatic activation
    // chooses it then, as arrow keys and Enter/Space still do
    onMouseDown={(event) => {
      onMouseDown?.(event)
      event.preventDefault()
    }}
    onClick={(event) => {
      onClick?.(event)
      if (!event.defaultPrevented) {
        event.currentTarget.focus()
      }
    }}
    className={cn(
      // The selected tab takes the same filled pill as a selected filter chip (the Lyrics page's)
      'inline-flex items-center justify-center rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap ring-offset-background transition-colors disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=inactive]:hover:text-foreground',
      compact
        ? 'relative after:absolute after:inset-x-0 after:-inset-y-1 touch:px-2'
        : 'touch:px-5',
      className
    )}
    {...props}
  />
)
const TabsTrigger = React.forwardRef(TabsTriggerRender)
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContentRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
> = ({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      // An inset ring, so a panel flush with a clipping edge (a popover's) still shows it
      'mt-2',
      className
    )}
    {...props}
  />
)
const TabsContent = React.forwardRef(TabsContentRender)
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsContent, TabsList, TabsTrigger }
