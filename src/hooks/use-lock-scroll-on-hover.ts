import { useEffect } from 'react'

export const useLockBodyScrollOnHover = (
  ref: React.RefObject<HTMLElement | null>,
  breakpointWidth: number
) => {
  useEffect(() => {
    const preventScroll = (event: WheelEvent): void => {
      if (event.deltaX !== 0) {
        event.preventDefault()
      }
    }

    const enableScrollLock = (): void => {
      window.addEventListener('wheel', preventScroll, { passive: false })
    }

    const disableScrollLock = (): void => {
      window.removeEventListener('wheel', preventScroll)
    }

    const checkWidthAndDisableScrollLock = (): void => {
      if (window.innerWidth <= breakpointWidth) {
        disableScrollLock()
      }
    }

    const node = ref.current

    if (node) {
      node.addEventListener('mouseenter', enableScrollLock)
      node.addEventListener('mouseleave', disableScrollLock)
      window.addEventListener('resize', checkWidthAndDisableScrollLock)

      return () => {
        disableScrollLock()
        node.removeEventListener('mouseenter', enableScrollLock)
        node.removeEventListener('mouseleave', disableScrollLock)
        window.removeEventListener('resize', checkWidthAndDisableScrollLock)
      }
    }
  }, [ref, breakpointWidth])
}
