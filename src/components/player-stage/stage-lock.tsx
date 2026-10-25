import { LockOpenIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useArmed } from '@/hooks/use-armed'
import { cn } from '@/utils/cn'

// How long the Unlock button stays after a tap shows it
const SHOWN_MS = 3000

// While the screen is locked a layer over the whole stage takes every tap, double tap and swipe, so nothing
// pauses, seeks or moves the lyrics by accident; the lyrics keep playing. A tap on the screen shows the Unlock
// button, fading in where Lock Screen was (on a phone on its side: the middle of the right-hand column's height),
// and another tap hides it again; left alone it fades out after a few seconds. It shows at first, so whoever
// locked sees where the way out is, and takes taps only once the tap that showed it has landed (useArmed), so
// that tap or a double tap can't unlock
export const StageLock = ({ onUnlock }: { onUnlock: () => void }) => {
  const [shown, setShown] = useState(true)
  const armed = useArmed(shown)
  useEffect(() => {
    const timer = shown
      ? setTimeout(() => {
          setShown(false)
        }, SHOWN_MS)
      : undefined
    return () => {
      clearTimeout(timer)
    }
  }, [shown])

  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a tap anywhere only shows or hides Unlock, which the keyboard reaches directly */}
      <div
        aria-hidden='true'
        data-testid='stage-lock'
        className='absolute inset-0 z-35 touch-none'
        onClick={() => {
          setShown(!shown)
        }}
      />
      <button
        type='button'
        onClick={onUnlock}
        onFocus={() => {
          setShown(true)
        }}
        className={cn(
          'absolute top-[calc(var(--stage-corner-top)+3.75rem)] right-[calc(var(--safe-right)+0.625rem)] z-36 flex h-11 items-center gap-2 rounded-full bg-black/55 pr-4 pl-3.5 text-sm font-medium text-white shadow-rail backdrop-blur-md transition-opacity duration-300 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:right-[calc(var(--safe-right)+1.125rem)] short:top-1/2 short:right-[calc(var(--spacing-controls-right)+0.25rem)] short:h-9 short:-translate-y-1/2 short:pr-3 short:pl-2.5',
          shown ? 'opacity-100' : 'opacity-0',
          (!shown || !armed) && 'pointer-events-none'
        )}>
        <LockOpenIcon className='size-5' aria-hidden='true' />
        Unlock
      </button>
    </>
  )
}
