import { useAtom, useSetAtom } from 'jotai'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  lyricsAnchorAtom,
  lyricsAnchorPortraitAtom,
  lyricsStylePanelAtom,
} from '@/context/atoms'
import { usePortrait } from '@/hooks/use-media-query'
import type { LyricsThemeColors } from '@/lib/lyrics-themes'
import { pagePoint } from '@/lib/page-turn'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import type { StageLayout } from './player-stage'
import { CONTROLS_FADE_MS } from './stage-controls'

const TAP_SLOP_PX = 4
const LIFT_MS = 200
const CLICK_AFTER_DRAG_MS = 400
// A drop whose bottom edge lands within this share of the lyrics' area from the bottom docks the block. A
// share, not pixels: the same few pixels are a finger's width on a phone and nothing on a desktop
const DOCK_REACH = 0.1

const swallow = (event: MouseEvent) => {
  event.stopPropagation()
  event.preventDefault()
}

const swallowNextClick = () => {
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => {
    window.removeEventListener('click', swallow, { capture: true })
  }, CLICK_AFTER_DRAG_MS)
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

interface DragStart {
  pointerY: number
  anchor: number
  range: number
  moved: boolean
}

interface DraggableLyricsProps {
  // Nothing between lines; the block stays mounted so a drag survives a gap in the lyrics
  children?: ReactNode
  layout: StageLayout
  scale: number
  backdrop: string
  colors: LyricsThemeColors
}

// `anchor` is where the viewer put the lyrics (0 = top, 1 = bottom of their
// area) and is what persists, once per drop. Flex spacers split the free
// space above and below the block by the anchor, so a taller or shorter line
// keeps its place without measuring. While the floating UI shows, the bottom
// spacer never shrinks below the part of the stage it covers
// (--stage-chrome-h), which lifts the block just clear of it, and it drops
// back once the UI has faded out. A drop near the bottom docks the block
// (anchor 1), so it rides the UI's edge both ways. Only the drawn text is
// grabbable; a press on it without a drag opens the rail's style panel, and
// a press beside or between its lines goes to the stage
export const DraggableLyrics = ({
  children,
  layout,
  scale,
  backdrop,
  colors,
}: DraggableLyricsProps) => {
  const [savedAnchor, setSavedAnchor] = useAtom(
    usePortrait() ? lyricsAnchorPortraitAtom : lyricsAnchorAtom
  )
  // Where the block follows the pointer during a drag; saved on the drop, not on every move
  const [dragAnchor, setDragAnchor] = useState<number | null>(null)
  const anchor = dragAnchor ?? savedAnchor
  const dragging = dragAnchor !== null
  const blockRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragStart | null>(null)
  const setStylePanel = useSetAtom(lyricsStylePanelAtom)

  // A drag cut off by leaving the page must not keep the controls hidden
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  })
  useEffect(
    () => () => {
      if (dragRef.current?.moved === true) {
        layoutRef.current.onDragChange(false)
      }
    },
    []
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const block = blockRef.current
    const layer = block?.parentElement
    if (!(block && layer)) {
      return
    }
    // Capture keeps the drag alive while the pointer crosses the iframe
    event.currentTarget.setPointerCapture(event.pointerId)
    // Start from where the block is drawn, which is above the saved anchor
    // while the controls lift it
    const room = layer.clientHeight - block.offsetHeight
    dragRef.current = {
      anchor: room > 0 ? clamp01(block.offsetTop / room) : anchor,
      moved: false,
      pointerY: pagePoint(event).y,
      range: Math.max(1, room),
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) {
      return
    }
    const delta = pagePoint(event).y - drag.pointerY
    if (!drag.moved) {
      if (Math.abs(delta) < TAP_SLOP_PX) {
        return
      }
      drag.moved = true
      layout.onDragChange(true)
    }
    setDragAnchor(clamp01(drag.anchor + delta / drag.range))
  }

  const handlePointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) {
      return
    }
    if (drag.moved) {
      const block = blockRef.current
      const layer = block?.parentElement
      // The floating UI is hidden while dragging, so this is the gap to the area's bottom edge
      const docked =
        block !== null &&
        layer !== null &&
        layer !== undefined &&
        layer.clientHeight - block.offsetTop - block.offsetHeight <=
          layer.clientHeight * DOCK_REACH
      setSavedAnchor(docked ? 1 : anchor)
      setDragAnchor(null)
      layout.onDragChange(false)
      // A drag that ends over the video must not also count as a tap on it
      swallowNextClick()
    } else {
      setStylePanel('pinned')
    }
  }

  // Never while dragging: the block follows the pointer exactly
  const settle = dragging ? 'none' : `flex-grow ${LIFT_MS}ms ease-out`
  const anchorVars: CssVars = {
    '--anchor-grow': anchor,
    '--anchor-transition': settle,
  }
  const blockVars: CssVars = {
    '--lyric-accent': colors.accent,
    '--lyric-glow': colors.glow,
    '--lyric-scale': scale,
  }
  const liftVars: CssVars = {
    '--lift-grow': 1 - anchor,
    '--lift-min-h': layout.controlsVisible ? 'var(--stage-chrome-h)' : '0px',
    // Lift at once when the controls appear; drop only after they fade. A
    // docking drop slides down with the spacer above, never delayed
    '--lift-transition': dragging
      ? 'none'
      : `min-height ${LIFT_MS}ms ease-out ${layout.controlsVisible ? 0 : CONTROLS_FADE_MS}ms, ${settle}`,
  }
  return (
    // A block taller than the room overflows upward, over the video, never down under the controls
    <div className='pointer-events-none absolute inset-0 flex flex-col justify-end'>
      <div className='anchor-spacer' style={anchorVars} />
      <div
        ref={blockRef}
        className={cn(
          'player-lyrics-overlay relative isolate shrink-0 px-3 py-cqh select-none',
          children === undefined && 'invisible'
        )}
        style={blockVars}
        data-backdrop={backdrop}>
        <div
          data-testid='lyrics-handle'
          data-lyrics-style-toggle
          className={cn(
            'lyrics-hit-text mx-auto w-fit max-w-full cursor-grab touch-none rounded-xl px-cqw ring-white/25 transition-surface hover:bg-white/5 hover:ring-1',
            dragging && 'cursor-grabbing bg-white/5 ring-1'
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}>
          {children}
        </div>
      </div>
      <div className='lyrics-lift' style={liftVars} />
    </div>
  )
}
