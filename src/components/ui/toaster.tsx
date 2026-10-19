'use client'

import type { ReactNode } from 'react'

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'
import { TOAST_REMOVE_DELAY } from '@/components/ui/use-toast'

import { useToast } from '../ui/use-toast'

const hasContent = (node: ReactNode) =>
  node !== undefined && node !== null && node !== false && node !== ''

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={TOAST_REMOVE_DELAY}>
      {toasts.map(({ id, title, description, action, duration, ...props }) => (
        <Toast key={id} duration={duration} {...props}>
          <div className='grid gap-1'>
            {hasContent(title) && <ToastTitle>{title}</ToastTitle>}
            {hasContent(description) && (
              <ToastDescription>{description}</ToastDescription>
            )}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
