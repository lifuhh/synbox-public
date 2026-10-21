import { LockIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useArmed } from '@/hooks/use-armed'
import { cn } from '@/utils/cn'

// How long a touch on the locked stage shows the Unlock button
const REVEAL_MS = 2500

// While the screen is locked a layer over the whole stage takes every tap, double tap and swipe, so nothing
// pauses, seeks or moves the lyrics by accident. A touch shows the Unlock button where Lock Screen was, and
// only a tap on it unlocks. It never appears under the touch that showed it: it waits as long as the rest
// of the floating UI does after a reveal (useArmed), so a stray double tap cannot unlock
export const StageLock = ({ onUnlock }: { onUnlock: () => void }) => {
  // Shown at first, so whoever locked sees where the way out is
  const [shown, setShown] = useState(true)
  const armed = useArmed(shown)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideLater = () => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setShown(false)
    }, REVEAL_MS)
  }

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true })
    timerRef.current = setTimeout(() => {
      setShown(false)
    }, REVEAL_MS)
    return () => {
      clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <>
      <div
        aria-hidden='true'
        data-testid='stage-lock'
        className='absolute inset-0 z-35 touch-none'
        onPointerDown={() => {
          setShown(true)
          hideLater()
        }}
      />
      <button
        ref={buttonRef}
        type='button'
        onClick={onUnlock}
        className={cn(
          'absolute top-(--stage-corner-top) right-controls-right z-36 flex h-11 items-center gap-2 rounded-full bg-black/55 pr-4 pl-3.5 text-sm font-medium text-white shadow-rail backdrop-blur-md transition-opacity duration-300 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          shown ? 'opacity-100' : 'opacity-0',
          !armed && 'pointer-events-none'
        )}>
        <LockIcon className='size-5' aria-hidden='true' />
        Unlock
      </button>
    </>
  )
}
