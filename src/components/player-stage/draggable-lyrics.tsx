import { useAtom, useSetAtom } from 'jotai'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

import {
  lyricsAnchorAtom,
  lyricsAnchorPortraitAtom,
  lyricsStylePanelAtom,
} from '@/context/atoms'
import { usePortrait } from '@/hooks/use-media-query'
import type { LyricsThemeColors } from '@/lib/lyrics-themes'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import type { StageLayout } from './player-stage'
import { CONTROLS_FADE_MS } from './stage-controls'

const TAP_SLOP_PX = 4
const LIFT_MS = 200
const CLICK_AFTER_DRAG_MS = 400
// A drop this close above the controls docks the block at the bottom
const DOCK_REACH_PX = 20

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

interface DragStart {
  pointerY: number
  anchor: number
  range: number
  moved: boolean
}

interface DraggableLyricsProps {
  children: ReactNode
  layout: StageLayout
  scale: number
  backdrop: string
  colors: LyricsThemeColors
}

// `anchor` is where the viewer put the lyrics (0 = top, 1 = bottom of the
// stage) and is what persists. Flex spacers split the free space above and
// below the block by the anchor, so a taller or shorter line keeps its place
// without measuring. The bottom spacer never shrinks below the
// controls, which lifts the block just clear of them, and it drops back once
// the controls have faded out. A drop on or just above the controls docks the
// block (anchor 1), so it rides the controls' edge both ways instead of
// stopping above them. Only the text box is
// grabbable; a press without a drag opens the rail's style panel, and the empty
// band beside the text passes clicks to the video
export const DraggableLyrics = ({
  children,
  layout,
  scale,
  backdrop,
  colors,
}: DraggableLyricsProps) => {
  const [anchor, setAnchor] = useAtom(
    usePortrait() ? lyricsAnchorPortraitAtom : lyricsAnchorAtom
  )
  const blockRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragStart | null>(null)
  const [dragging, setDragging] = useState(false)
  const setStylePanel = useSetAtom(lyricsStylePanelAtom)

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
      anchor: room > 0 ? block.offsetTop / room : anchor,
      moved: false,
      pointerY: event.clientY,
      range: Math.max(1, room),
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) {
      return
    }
    const delta = event.clientY - drag.pointerY
    if (!drag.moved) {
      if (Math.abs(delta) < TAP_SLOP_PX) {
        return
      }
      drag.moved = true
      setDragging(true)
      layout.onDragChange(true)
    }
    setAnchor(Math.min(1, Math.max(0, drag.anchor + delta / drag.range)))
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
      // The controls are hidden while dragging, so this is the gap to the stage's bottom edge
      if (
        block &&
        layer &&
        layer.clientHeight - block.offsetTop - block.offsetHeight <=
          layout.controlsHeight + DOCK_REACH_PX
      ) {
        setAnchor(1)
      }
      setDragging(false)
      layout.onDragChange(false)
      // A drag that ends over the video must not also count as a tap on it
      swallowNextClick()
    } else {
      setStylePanel('pinned')
    }
  }

  // Never while dragging: the block follows the pointer exactly
  const settle = dragging ? 'none' : `flex-grow ${LIFT_MS}ms ease-out`
  const bottomObstruction = layout.controlsVisible ? layout.controlsHeight : 0
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
    '--lift-min-h': `${bottomObstruction}px`,
    // Lift at once when the controls appear; drop only after they fade. A
    // docking drop slides down with the spacer above, never delayed
    '--lift-transition': dragging
      ? 'none'
      : `min-height ${LIFT_MS}ms ease-out ${bottomObstruction > 0 ? 0 : CONTROLS_FADE_MS}ms, ${settle}`,
  }
  return (
    // A block taller than the room overflows upward, over the video, never down under the controls
    <div className='pointer-events-none absolute inset-0 flex flex-col justify-end'>
      <div className='anchor-spacer' style={anchorVars} />
      <div
        ref={blockRef}
        className='player-lyrics-overlay relative isolate shrink-0 px-3 py-cqh select-none'
        style={blockVars}
        data-backdrop={backdrop}>
        <div
          data-testid='lyrics-handle'
          data-lyrics-style-toggle
          className={cn(
            'pointer-events-auto mx-auto w-fit max-w-full cursor-grab touch-none rounded-xl px-cqw ring-white/25 transition-surface hover:bg-white/5 hover:ring-1 touch:w-full',
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
