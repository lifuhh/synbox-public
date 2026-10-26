'use client'

import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as React from 'react'

import { cn } from '@/utils/cn'

const Tabs = TabsPrimitive.Root

const TabsListRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
> = ({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-10 items-center justify-center gap-1 rounded-full bg-muted p-1 text-muted-foreground',
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
    // Tabs that share the row's width equally (Library's): the row spreads them, so they need less padding
    stretch?: boolean
  }
> = ({ className, stretch = false, onMouseDown, onClick, ...props }, ref) => (
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
      stretch ? 'flex-1 px-3' : 'touch:px-5',
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
