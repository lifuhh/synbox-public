import { useCallback } from 'react'

const watch = (el: HTMLElement) => {
  const update = () => {
    el.toggleAttribute('data-fade-start', el.scrollLeft > 1)
    el.toggleAttribute(
      'data-fade-end',
      el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    )
  }
  update()
  el.addEventListener('scroll', update, { passive: true })
  const resized = new ResizeObserver(update)
  resized.observe(el)
  const changed = new MutationObserver(update)
  changed.observe(el, { childList: true, subtree: true })
  return () => {
    el.removeEventListener('scroll', update)
    resized.disconnect()
    changed.disconnect()
  }
}

// A ref callback that marks a sideways scroller with data-fade-start / data-fade-end while it has content past that
// edge, for `mask-fade-x`. Rechecked on scroll, on resize, and when its children change (a chip added or removed).
// A ref callback rather than an effect: the scroller can mount after its component (Up Next's chips wait for data)
export const useScrollEdges = () =>
  useCallback((el: HTMLElement | null) => (el ? watch(el) : undefined), [])
