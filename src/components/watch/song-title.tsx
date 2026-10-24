import { useLayoutEffect, useRef, useState } from 'react'

import { bracketStart } from '@/utils'
import { cn } from '@/utils/cn'

// Whether the title needs more than two lines at its width. `scrollHeight` is the whole text's height, clamped or
// not, so this reads the same expanded or collapsed. The threshold is two and a half lines, not two: a fallback
// font's taller glyphs (kana beside Latin) can make two lines a few px taller than two line-heights
const needsMoreThanTwoLines = (text: HTMLElement) => {
  // oxlint-disable-next-line unicorn/prefer-number-coercion -- the value ends in px, which Number() rejects
  const line = Number.parseFloat(getComputedStyle(text).lineHeight)
  return text.scrollHeight > 2.5 * line
}

// The song's title under the video, cut to two lines. Only a title that is actually cut is a button, which shows
// it whole and cuts it again; one that fits is plain text. The whole title is in the DOM either way, so a screen
// reader reads all of it. `className` sets the size and weight on the <h1>
const Title = ({ title, className }: { title: string; className: string }) => {
  const heading = useRef<HTMLHeadingElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Measured before paint, then again when the width changes or a font slice arrives (a Japanese title's glyphs
  // load after the first frame and can add or remove a line)
  useLayoutEffect(() => {
    const measure = () => {
      if (text.current) {
        setCut(needsMoreThanTwoLines(text.current))
      }
    }
    measure()
    const resize = new ResizeObserver(measure)
    if (heading.current) {
      resize.observe(heading.current)
    }
    document.fonts.addEventListener('loadingdone', measure)
    return () => {
      resize.disconnect()
      document.fonts.removeEventListener('loadingdone', measure)
    }
  }, [])

  const words = (
    <span
      ref={text}
      className={cn(
        'block',
        // Pretty wrapping balances the last lines, so the cut and the whole title broke their first two lines in
        // different places, and expanding moved words that were already showing. A title that is cut wraps plainly
        cut ? !expanded && 'line-clamp-2' : 'line-clamp-2 text-pretty',
        bracketStart(title)
      )}>
      {title}
    </span>
  )
  return (
    <h1 ref={heading} className={cn('text-foreground', className)}>
      {cut ? (
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded)
          }}
          className='block w-full rounded-sm text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'>
          {words}
        </button>
      ) : (
        words
      )}
    </h1>
  )
}

// A new song is a new title, measured afresh and collapsed: a resize can't be relied on to re-measure, since a
// title cut to two lines and one that fits in two have the same box
export const SongTitle = (props: { title: string; className: string }) => (
  <Title key={props.title} {...props} />
)
