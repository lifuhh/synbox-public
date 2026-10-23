import { useEffect, useRef, useState } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import { createPortal } from 'react-dom'

import { useMediaQuery } from '@/hooks/use-media-query'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

const WIDE = '(min-width: 1000px)'
// A mouse or trackpad. Touch screens keep the browser's own bar, which already shows only while a finger scrolls
const FINE = '(pointer: fine)'
// How long the bar stays after the page last moved or the pointer left it
const LINGER_MS = 1000

interface Thumb {
  top: number
  height: number
}

const measure = (box: HTMLElement): Thumb | null => {
  const { clientHeight, scrollHeight, scrollTop } = box
  if (scrollHeight <= clientHeight + 1) {
    return null
  }
  const height = Math.max(32, (clientHeight * clientHeight) / scrollHeight)
  const top =
    (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height)
  return { height, top }
}

// The page's scrollbar, drawn here instead of the browser's, which is hidden (globals.css `html[data-doc-scroll]`,
// `[data-overlay-scrollbar]`). `box` is what scrolls: the document, or a page's own box spanning the window. It
// shows while the page moves and while the pointer is on it, floating on the window's right edge above the top
// bar, so the bar never hides it. With no browser scrollbar, a menu's scroll lock has no bar width to take away,
// and showing it takes none either, so nothing moves
const OverlayScrollbar = ({ box }: { box: HTMLElement }) => {
  const [thumb, setThumb] = useState<Thumb | null>(null)
  const [moving, setMoving] = useState(false)
  const [held, setHeld] = useState(false)
  const [near, setNear] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const drag = useRef<{ y: number; scrollTop: number } | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const doc = box === document.documentElement

  // The pointer within the strip's width of the window's right edge shows the bar. Read from the window, not from
  // a hit area: an invisible strip that took presses blocked the content's right edge in a narrow window
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const width = strip.current?.offsetWidth ?? 0
      setNear(
        event.pointerType === 'mouse' &&
          event.clientX >= window.innerWidth - width
      )
    }
    const onLeave = () => {
      setNear(false)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  useEffect(() => {
    const update = () => {
      setThumb(measure(box))
    }
    const onScroll = () => {
      update()
      setMoving(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setMoving(false)
      }, LINGER_MS)
    }
    update()
    // The document's scroll events fire on document; its content is the body. A box's content is its children
    const scrolls: Document | HTMLElement = doc ? document : box
    const resize = new ResizeObserver(update)
    const observe = () => {
      for (const el of doc ? [document.body] : [box, ...box.children]) {
        resize.observe(el)
      }
    }
    // A box's child that mounts later (a loaded list in place of its placeholder)
    const added = new MutationObserver(() => {
      observe()
      update()
    })
    observe()
    if (!doc) {
      added.observe(box, { childList: true })
    }
    scrolls.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      clearTimeout(timer.current)
      resize.disconnect()
      added.disconnect()
      scrolls.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', update)
    }
  }, [box, doc])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { scrollTop: box.scrollTop, y: event.clientY }
    setHeld(true)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current
    const now = thumb
    if (start === null || now === null) {
      return
    }
    const track = box.clientHeight - now.height
    const range = box.scrollHeight - box.clientHeight
    box.scrollTo({
      behavior: 'instant',
      top: start.scrollTop + ((event.clientY - start.y) / track) * range,
    })
  }
  const onPointerUp = () => {
    drag.current = null
    setHeld(false)
  }
  // The wheel over the thumb: it sits outside a page's box, so the box would not get it. The document does
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!doc) {
      box.scrollBy({ behavior: 'instant', top: event.deltaY })
    }
  }

  if (thumb === null) {
    return null
  }
  const thumbVars: CssVars = {
    '--thumb-h': `${thumb.height}px`,
    '--thumb-y': `${thumb.top}px`,
  }
  const shown = moving || held || near
  // The strip never takes presses; only the thumb does, and only while it shows. Width and colour are the app's own
  // scrollbar's (`custom-scrollbar`): 6px, flush right, the theme colour at 35%, 65% under the pointer
  return (
    <div
      ref={strip}
      aria-hidden
      data-scrollbar
      className='pointer-events-none fixed top-0 right-0 bottom-0 z-60 w-(--doc-gutter)'>
      <div
        data-scrollbar-thumb
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        style={thumbVars}
        className={cn(
          'absolute top-0 right-0 h-(--thumb-h) w-1.5 translate-y-(--thumb-y) touch-none rounded-full bg-primary/35 opacity-0 transition duration-200 motion-reduce:transition-none',
          shown && 'pointer-events-auto opacity-100',
          (near || held) && 'bg-primary/65'
        )}
      />
    </div>
  )
}

// Makes the page scroll the document as a whole from 1000px wide (the `doc-scroll` variant in globals.css), with
// OverlayScrollbar as its scrollbar. Rendered by the pages that scroll this way (watch page, Admin, Versions)
export const DocScroll = () => {
  const wide = useMediaQuery(WIDE)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-doc-scroll', true)
    return () => {
      delete document.documentElement.dataset.docScroll
    }
  }, [])
  return wide ? <OverlayScrollbar box={document.documentElement} /> : null
}

// The scrollbar of a page that scrolls its own window-high box (home, search, the lists), with a mouse or
// trackpad: hides the box's own bar (`data-overlay-scrollbar` in globals.css) and draws OverlayScrollbar instead.
// Rendered in the box, drawn in the body: a box that animates a filter (home's rise-in) would hold a fixed bar in
// itself, and the bar's strip stays out of the box's own content
export const BoxScrollbar = ({ box }: { box: HTMLElement | null }) => {
  const fine = useMediaQuery(FINE)
  const drawn = fine && box !== null
  useEffect(() => {
    box?.toggleAttribute('data-overlay-scrollbar', drawn)
    return () => {
      if (box !== null) {
        delete box.dataset.overlayScrollbar
      }
    }
  }, [box, drawn])
  return drawn
    ? createPortal(<OverlayScrollbar box={box} />, document.body)
    : null
}
