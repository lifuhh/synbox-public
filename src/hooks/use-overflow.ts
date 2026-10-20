import type { RefObject } from 'react'
import { useEffect, useState } from 'react'

// Whether the text is wider than its container. The observer also fires when the text itself changes width,
// so a new title is measured without listing it as a dependency
export const useOverflow = (
  textRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>
) => {
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const text = textRef.current
      const container = containerRef.current
      if (text && container) {
        setOverflowing(text.scrollWidth > container.clientWidth)
      }
    })
    for (const element of [textRef.current, containerRef.current]) {
      if (element) {
        observer.observe(element)
      }
    }
    return () => {
      observer.disconnect()
    }
  }, [textRef, containerRef])

  return overflowing
}
