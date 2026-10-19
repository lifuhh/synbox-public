import { useAtom } from 'jotai'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { lyricsAnchorAtom } from '@/context/atoms'
import { cn } from '@/utils/cn'

import type { StageLayout } from './PlayerStage'
import { CONTROLS_FADE_MS } from './StageControls'

const TAP_SLOP_PX = 4

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
  style?: CSSProperties
}

// `anchor` is where the viewer put the lyrics (0 = top, 1 = bottom of the
// stage) and is what persists. While the controls cover the bottom of the
// stage, the block is lifted just clear of them, and drops back once they have
// faded out. Only the text box is grabbable; a press without a drag does
// nothing, and the empty band beside the text passes clicks to the video
export const DraggableLyrics = ({
  children,
  layout,
  scale,
  backdrop,
  style,
}: DraggableLyricsProps) => {
  const [anchor, setAnchor] = useAtom(lyricsAnchorAtom)
  const blockRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragStart | null>(null)
  const [dragging, setDragging] = useState(false)
  const [size, setSize] = useState({ layer: 0, block: 0 })

  useEffect(() => {
    const block = blockRef.current
    const layer = block?.parentElement
    if (!(block && layer)) {
      return
    }
    const observer = new ResizeObserver(() => {
      setSize({ layer: layer.clientHeight, block: block.offsetHeight })
    })
    observer.observe(block)
    observer.observe(layer)
    return () => {
      observer.disconnect()
    }
  }, [])

  const room = Math.max(0, size.layer - size.block)
  const placed = anchor * room
  const offset = Math.max(0, Math.min(placed, room - layout.bottomObstruction))

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Capture keeps the drag alive while the pointer crosses the iframe
    event.currentTarget.setPointerCapture(event.pointerId)
    // Start from where the block is drawn, which is above the saved anchor
    // while the controls lift it
    dragRef.current = {
      pointerY: event.clientY,
      anchor: room > 0 ? offset / room : anchor,
      range: Math.max(1, room),
      moved: false,
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
      setDragging(false)
      layout.onDragChange(false)
    }
  }

  return (
    <div
      ref={blockRef}
      className={cn(
        'player-lyrics-overlay pointer-events-none absolute inset-x-0 top-0 py-[1cqh] select-none',
        !dragging && 'transition-transform duration-200 ease-out',
        size.layer === 0 && 'invisible'
      )}
      style={
        {
          transform: `translateY(${offset}px)`,
          // Lift at once when the controls appear; drop only after they fade.
          // Never while dragging: a delay alone holds the old position
          transitionDelay:
            dragging || layout.bottomObstruction > 0
              ? '0ms'
              : `${CONTROLS_FADE_MS}ms`,
          '--lyric-scale': scale,
          ...style,
        } as CSSProperties
      }
      data-backdrop={backdrop}
      data-position={anchor >= 0.5 ? 'bottom' : 'top'}>
      <div
        data-testid='lyrics-handle'
        className={cn(
          'pointer-events-auto mx-auto w-fit max-w-full cursor-grab touch-none rounded-xl px-[1cqw] ring-white/25 transition-[background-color,box-shadow] hover:bg-white/5 hover:ring-1',
          dragging && 'cursor-grabbing bg-white/5 ring-1'
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}>
        {children}
      </div>
    </div>
  )
}
