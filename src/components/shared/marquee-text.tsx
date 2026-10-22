import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

// How fast a long title scrolls: slow enough to read as it moves
const SPEED_PX_PER_S = 40
// The share of each sweep spent still at either end (see @keyframes marquee-scroll), and the shortest sweep, so
// a title only a little too long doesn't flick back and forth
const PAUSED_SHARE = 0.16
const MIN_SWEEP_S = 4

// One line of text. When it is too long for its box it fades at its end, and while the pointer is on its row
// (an ancestor marked data-marquee-host) or the keyboard is in it, it scrolls to its end and back by exactly the
// distance that is hidden, pausing at each end. Still under reduced motion and on touch, where nothing hovers
export const MarqueeText = ({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) => {
  const boxRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [hidden, setHidden] = useState(0)

  // The observer also fires when the text changes width, so a new title is measured without listing it
  useEffect(() => {
    const box = boxRef.current
    const text = textRef.current
    const observer = new ResizeObserver(() => {
      if (box && text) {
        setHidden(Math.max(0, text.scrollWidth - box.clientWidth))
      }
    })
    for (const element of [box, text]) {
      if (element) {
        observer.observe(element)
      }
    }
    return () => {
      observer.disconnect()
    }
  }, [])

  const vars: CssVars | undefined =
    hidden > 0
      ? {
          '--marquee-duration': `${Math.max(MIN_SWEEP_S, hidden / SPEED_PX_PER_S / (1 - PAUSED_SHARE)).toFixed(2)}s`,
          '--marquee-shift': `${-hidden}px`,
        }
      : undefined
  return (
    <span
      ref={boxRef}
      data-marquee={hidden > 0 || undefined}
      style={vars}
      className={cn('marquee block', className)}>
      <span ref={textRef}>{children}</span>
    </span>
  )
}
