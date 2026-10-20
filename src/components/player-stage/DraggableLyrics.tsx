import { useAtom, useSetAtom } from 'jotai'
import type { CSSProperties, ReactNode } from 'react'
import { useRef, useState } from 'react'

import {
  lyricsAnchorAtom,
  lyricsAnchorPortraitAtom,
  lyricsStylePanelAtom,
} from '@/context/atoms'
import { usePortrait } from '@/hooks/useMediaQuery'
import { cn } from '@/utils/cn'

import type { StageLayout } from './PlayerStage'
import { CONTROLS_FADE_MS } from './StageControls'

const TAP_SLOP_PX = 4
const LIFT_MS = 200

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
// stage) and is what persists. Flex spacers split the free space above and
// below the block by the anchor, so a taller or shorter line keeps its place
// without measuring or animating. The bottom spacer never shrinks below the
// controls, which lifts the block just clear of them; only that lift animates,
// and it drops back once the controls have faded out. Only the text box is
// grabbable; a press without a drag opens the rail's style panel, and the empty
// band beside the text passes clicks to the video
export const DraggableLyrics = ({
  children,
  layout,
  scale,
  backdrop,
  style,
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
      pointerY: event.clientY,
      anchor: room > 0 ? block.offsetTop / room : anchor,
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
    } else {
      setStylePanel('pinned')
    }
  }

  return (
    <div className='pointer-events-none absolute inset-0 flex flex-col'>
      <div style={{ flexGrow: anchor }} />
      <div
        ref={blockRef}
        className='player-lyrics-overlay relative isolate shrink-0 px-3 py-[1cqh] select-none'
        style={
          {
            '--lyric-scale': scale,
            ...style,
          } as CSSProperties
        }
        data-backdrop={backdrop}>
        <div
          data-testid='lyrics-handle'
          data-lyrics-style-toggle
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
      <div
        style={{
          flexGrow: 1 - anchor,
          minHeight: layout.bottomObstruction,
          // Lift at once when the controls appear; drop only after they fade.
          // Never while dragging: the block follows the pointer exactly
          transition: dragging ? 'none' : `min-height ${LIFT_MS}ms ease-out`,
          transitionDelay:
            layout.bottomObstruction > 0 ? '0ms' : `${CONTROLS_FADE_MS}ms`,
        }}
      />
    </div>
  )
}
