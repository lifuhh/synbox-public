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
import { TOAST_REMOVE_DELAY, useToast } from '@/components/ui/use-toast'

const hasContent = (node: ReactNode) =>
  node !== undefined && node !== null && node !== false && node !== ''

export const Toaster = () => {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={TOAST_REMOVE_DELAY}>
      {toasts.map(
        ({ id, title, description, icon, action, duration, ...props }) => (
          <Toast key={id} duration={duration} {...props}>
            <div className='flex min-w-0 items-center gap-3'>
              {icon}
              <div className='grid gap-0.5'>
                {hasContent(title) && <ToastTitle>{title}</ToastTitle>}
                {hasContent(description) && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      )}
      <ToastViewport />
    </ToastProvider>
  )
}
