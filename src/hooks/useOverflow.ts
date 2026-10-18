import { useEffect } from 'react'

export function useOverflow(textRef, containerRef, overflowClass: string) {
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
