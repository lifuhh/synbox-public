import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

const WIDE = '(min-width: 1000px)'
// How long the bar stays after the page last moved or the pointer left it
const LINGER_MS = 1000

interface Thumb {
  top: number
  height: number
}

const measure = (): Thumb | null => {
  const root = document.documentElement
  const { clientHeight, scrollHeight, scrollTop } = root
  if (scrollHeight <= clientHeight + 1) {
    return null
  }
  const height = Math.max(32, (clientHeight * clientHeight) / scrollHeight)
  const top =
    (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height)
  return { height, top }
}

// The page's scrollbar while it scrolls the document as a whole (watch page, Admin), from 1000px wide: drawn here
// instead of the browser's, which is hidden (globals.css `html[data-doc-scroll]`). It shows while the page moves
// and while the pointer is on it, floating in a gutter on the window's right edge that the page leaves empty.
// With no browser scrollbar, a menu's scroll lock has no bar width to take away, so opening one moves nothing
const DocScrollbar = () => {
  const [thumb, setThumb] = useState<Thumb | null>(null)
  const [moving, setMoving] = useState(false)
  const [held, setHeld] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const drag = useRef<{ y: number; scrollTop: number } | null>(null)

  useEffect(() => {
    const update = () => {
      setThumb(measure())
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
    const resize = new ResizeObserver(update)
    resize.observe(document.body)
    document.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      clearTimeout(timer.current)
      resize.disconnect()
      document.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', update)
    }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      scrollTop: document.documentElement.scrollTop,
      y: event.clientY,
    }
    setHeld(true)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current
    const now = thumb
    if (start === null || now === null) {
      return
    }
    const root = document.documentElement
    const track = root.clientHeight - now.height
    const range = root.scrollHeight - root.clientHeight
    root.scrollTop =
      start.scrollTop + ((event.clientY - start.y) / track) * range
  }
  const onPointerUp = () => {
    drag.current = null
    setHeld(false)
  }

  if (thumb === null) {
    return null
  }
  const thumbVars: CssVars = {
    '--thumb-h': `${thumb.height}px`,
    '--thumb-y': `${thumb.top}px`,
  }
  return (
    <div
      aria-hidden
      className='group fixed top-0 right-0 bottom-0 z-60 w-(--doc-gutter)'>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={thumbVars}
        className={cn(
          'absolute top-0 right-0.5 h-(--thumb-h) w-2 translate-y-(--thumb-y) touch-none rounded-full bg-foreground/35 opacity-0 transition duration-200 group-hover:bg-foreground/55 group-hover:opacity-100 motion-reduce:transition-none',
          (moving || held) && 'opacity-100',
          held && 'bg-foreground/55'
        )}
      />
    </div>
  )
}

// Makes the page scroll the document as a whole from 1000px wide (the `doc-scroll` variant in globals.css), with
// DocScrollbar as its scrollbar. Rendered by the pages that scroll this way
export const DocScroll = () => {
  const wide = useMediaQuery(WIDE)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-doc-scroll', true)
    return () => {
      delete document.documentElement.dataset.docScroll
    }
  }, [])
  return wide ? <DocScrollbar /> : null
}
