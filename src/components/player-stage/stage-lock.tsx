import { LockIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { useArmed } from '@/hooks/use-armed'
import { cn } from '@/utils/cn'

// While the screen is locked a layer over the whole stage takes every tap, double tap and swipe, so nothing
// pauses, seeks or moves the lyrics by accident. The Unlock button stays on screen the whole time, where Lock
// Screen was (on a phone on its side: the second slot of the right-hand column, top, right edge and height
// alike): a way out that hides, or only answers a tap timed after another, is a way out people miss. It
// takes taps once the tap that locked has landed (useArmed), so that tap cannot unlock again
export const StageLock = ({ onUnlock }: { onUnlock: () => void }) => {
  const armed = useArmed(true)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <>
      <div
        aria-hidden='true'
        data-testid='stage-lock'
        className='absolute inset-0 z-35 touch-none'
      />
      <button
        ref={buttonRef}
        type='button'
        onClick={onUnlock}
        className={cn(
          'absolute top-[calc(var(--stage-corner-top)+3.25rem)] right-[calc(var(--safe-right)+0.875rem)] z-36 flex h-11 items-center gap-2 rounded-full bg-black/55 pr-4 pl-3.5 text-sm font-medium text-white shadow-rail backdrop-blur-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:right-[calc(var(--safe-right)+1.375rem)] short:top-[calc(var(--topbar-h)+2.75rem)] short:right-[calc(var(--safe-right)+0.25rem)] short:h-8 short:pr-3 short:pl-2.5',
          !armed && 'pointer-events-none'
        )}>
        <LockIcon className='size-5' aria-hidden='true' />
        Unlock
      </button>
    </>
  )
}
