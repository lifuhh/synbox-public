import { useEffect } from 'react'

// How long the row rests on a song before moving on by itself, counted from when it last moved
const REST_MS = 6000
// The row must be at least this much in view to move on its own
const IN_VIEW = 0.5

// What holds the row still: a pointer over it (a finger counts while it touches), keyboard focus inside it, the
// tab in the background, the row scrolled out of view, or a reader who asked for less motion
type Hold = 'pointer' | 'focus' | 'hidden' | 'away' | 'still'

// Moves the row on by one song every REST_MS while nothing holds it. A touch, scroll, key or hover restarts the
// wait from the beginning, so the row never moves under someone's hand or right after they let go
export const useAutoAdvance = (
  area: HTMLElement | null,
  advance: () => void
) => {
  useEffect(() => {
    const run = (el: HTMLElement) => {
      const holds = new Set<Hold>()
      let timer = 0

      const restart = () => {
        window.clearTimeout(timer)
        if (holds.size === 0) {
          timer = window.setTimeout(advance, REST_MS)
        }
      }
      const hold = (reason: Hold, on: boolean) => {
        if (on) {
          holds.add(reason)
        } else {
          holds.delete(reason)
        }
        restart()
      }

      const onPointerEnter = () => {
        hold('pointer', true)
      }
      const onPointerLeave = () => {
        hold('pointer', false)
      }
      // A mouse click leaves focus on a button without showing it; only keyboard focus holds the row
      const onFocusIn = (event: FocusEvent) => {
        if (event.target instanceof Element) {
          hold('focus', event.target.matches(':focus-visible'))
        }
      }
      const onFocusOut = (event: FocusEvent) => {
        if (
          !(
            event.relatedTarget instanceof Node &&
            el.contains(event.relatedTarget)
          )
        ) {
          hold('focus', false)
        }
      }
      const onVisibility = () => {
        hold('hidden', document.hidden)
      }
      const still = matchMedia('(prefers-reduced-motion: reduce)')
      const onStill = () => {
        hold('still', still.matches)
      }
      const view = new IntersectionObserver(
        ([entry]) => {
          hold('away', entry.intersectionRatio < IN_VIEW)
        },
        { threshold: IN_VIEW }
      )

      // A pointer already resting over the row when it appears fires no pointerenter
      if (matchMedia('(hover: hover)').matches && el.matches(':hover')) {
        holds.add('pointer')
      }
      onVisibility()
      onStill()
      view.observe(el)
      el.addEventListener('pointerenter', onPointerEnter)
      el.addEventListener('pointerleave', onPointerLeave)
      el.addEventListener('focusin', onFocusIn)
      el.addEventListener('focusout', onFocusOut)
      // Scrolling (the row's own glides included) and keys restart the wait; scroll doesn't bubble, so capture it
      el.addEventListener('scroll', restart, { capture: true, passive: true })
      el.addEventListener('wheel', restart, { passive: true })
      el.addEventListener('keydown', restart)
      document.addEventListener('visibilitychange', onVisibility)
      still.addEventListener('change', onStill)
      return () => {
        window.clearTimeout(timer)
        view.disconnect()
        el.removeEventListener('pointerenter', onPointerEnter)
        el.removeEventListener('pointerleave', onPointerLeave)
        el.removeEventListener('focusin', onFocusIn)
        el.removeEventListener('focusout', onFocusOut)
        el.removeEventListener('scroll', restart, { capture: true })
        el.removeEventListener('wheel', restart)
        el.removeEventListener('keydown', restart)
        document.removeEventListener('visibilitychange', onVisibility)
        still.removeEventListener('change', onStill)
      }
    }
    return area ? run(area) : undefined
  }, [area, advance])
}
