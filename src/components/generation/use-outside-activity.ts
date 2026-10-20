import { useIsPresent } from 'motion/react'
import type { RefObject } from 'react'
import { useEffect, useEffectEvent } from 'react'

const MODIFIERS = new Set(['Alt', 'Control', 'Meta', 'Shift'])

// Calls `onActivity` when the listener does something deliberate elsewhere on the page: presses, scrolls
// or types outside `ref`. Only input counts, so the player's own scrolling and a resting pointer do not.
export const useOutsideActivity = (
  ref: RefObject<HTMLElement | null>,
  onActivity: () => void
) => {
  // A panel already leaving stays mounted for its exit, and must not fire again
  const present = useIsPresent()
  const notify = useEffectEvent(onActivity)

  useEffect(() => {
    const outside = (event: Event) =>
      event.target instanceof Node &&
      ref.current !== null &&
      !ref.current.contains(event.target)
    const onInput = (event: Event) => {
      if (outside(event)) {
        notify()
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (!event.repeat && !MODIFIERS.has(event.key)) {
        onInput(event)
      }
    }
    const listen = () => {
      const options = { capture: true, passive: true }
      document.addEventListener('pointerdown', onInput, options)
      document.addEventListener('wheel', onInput, options)
      document.addEventListener('keydown', onKey, options)
      return () => {
        document.removeEventListener('pointerdown', onInput, options)
        document.removeEventListener('wheel', onInput, options)
        document.removeEventListener('keydown', onKey, options)
      }
    }
    return present ? listen() : undefined
  }, [present, ref])
}
