import type { RefObject } from 'react'
import { useEffect } from 'react'

export const useOverflow = (
  textRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>,
  overflowClass: string
) => {
  useEffect(() => {
    const checkIfOverflows = () => {
      const textWidth = textRef.current?.offsetWidth ?? 0
      const containerWidth = containerRef.current?.offsetWidth ?? 0
      containerRef.current?.classList.toggle(
        overflowClass,
        textWidth > containerWidth
      )
    }
    checkIfOverflows()
  }, [textRef, containerRef, overflowClass])
}
