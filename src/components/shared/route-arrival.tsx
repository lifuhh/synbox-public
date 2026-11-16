import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

// The player reads its keys from the page itself (player-stage.tsx › playerOwnsKey), so focus never rests on
// the page's box there
const PLAYER = /^\/v\/[^/]+\/?$/u
// A lazy page's <title> lands a moment after the address changes
const TITLE_SETTLE_MS = 300

const pageBox = () => document.querySelector<HTMLElement>('[data-page-content]')

const isEditable = (element: Element | null) =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))

export const focusPage = () => {
  pageBox()?.focus({ preventScroll: true })
}

// A page change in a single-page app tells a screen reader nothing and leaves keyboard focus on the link that
// was pressed, often now gone. So each one moves focus to the new page's box (Tab then starts in the page, not
// back at the top bar) and says the page's title in a polite live region (WCAG 2.4.3, 4.1.3). Focus stays where
// it is when the new page took it itself or the viewer is typing (the top bar's search opening the Search page)
const RouteArrival = () => {
  const { pathname } = useLocation()
  const [title, setTitle] = useState('')
  const shownPath = useRef(pathname)

  useEffect(() => {
    // Not the page the visit opened on: the browser announced that one itself
    const arrived = shownPath.current !== pathname
    shownPath.current = pathname
    // A frame later: the browser drops focus from the pressed link as its page is removed, after this effect
    const frame = requestAnimationFrame(() => {
      if (!arrived) {
        return
      }
      const page = pageBox()
      const active = document.activeElement
      if (PLAYER.test(pathname)) {
        if (active === page) {
          page?.blur()
        }
      } else if (
        page !== null &&
        !isEditable(active) &&
        !(active !== null && active !== page && page.contains(active))
      ) {
        focusPage()
      }
    })
    const id = setTimeout(() => {
      if (arrived) {
        setTitle(document.title)
      }
    }, TITLE_SETTLE_MS)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(id)
    }
  }, [pathname])

  return (
    <output aria-atomic='true' className='sr-only'>
      {title}
    </output>
  )
}

export default RouteArrival
