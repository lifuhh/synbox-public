'use client'

import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { ChevronDown } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/utils/cn'

const Accordion = AccordionPrimitive.Root

const AccordionItemRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
> = ({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn('border-b', className)}
    {...props}
  />
)
const AccordionItem = React.forwardRef(AccordionItemRender)
AccordionItem.displayName = 'AccordionItem'

const accordionTriggerVariants = cva('', {
  defaultVariants: { size: 'default' },
  variants: {
    size: {
      default: '',
      lg: 'text-lg',
    },
  },
})

const AccordionTriggerRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> &
    VariantProps<typeof accordionTriggerVariants>
> = ({ className, children, size, ...props }, ref) => (
  <AccordionPrimitive.Header className='flex'>
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180',
        accordionTriggerVariants({ size }),
        className
      )}
      {...props}>
      {children}
      <ChevronDown className='h-4 w-4 shrink-0 transition-transform duration-200' />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
)
const AccordionTrigger = React.forwardRef(AccordionTriggerRender)
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName

const AccordionContentRender: React.ForwardRefRenderFunction<
  React.ComponentRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
> = ({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className='overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down'
    {...props}>
    <div className={cn('pt-0 pb-4', className)}>{children}</div>
  </AccordionPrimitive.Content>
)
const AccordionContent = React.forwardRef(AccordionContentRender)

AccordionContent.displayName = AccordionPrimitive.Content.displayName

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger }
