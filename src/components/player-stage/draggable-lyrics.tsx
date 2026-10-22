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
import { fractionAcross, pagePoint } from '@/lib/page-turn'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import type { StageLayout } from './player-stage'
import { CONTROLS_FADE_MS } from './stage-controls'

// How far a press must travel to count as a drag: a fingertip rolls further than a mouse wobbles
const TAP_SLOP_PX = { mouse: 4, touch: 10 }
const LIFT_MS = 200
const CLICK_AFTER_DRAG_MS = 400
// A drop whose bottom edge lands within this share of the lyrics' area from the bottom docks the block. A
// share, not pixels: the same few pixels are a finger's width on a phone and nothing on a desktop. Small, so
// lyrics placed just above the controls stay there when they hide instead of docking and dropping with them
const DOCK_REACH = 0.04

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
  slop: number
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
  // The whole width to lay out in (Karaoke Stagger's left and right lines), instead of a centred fit
  wide?: boolean
}

// `anchor` is where the viewer put the lyrics (0 = top, 1 = bottom of their
// area) and is what persists, once per drop. Flex spacers split the free
// space above and below the block by the anchor, so a taller or shorter line
// keeps its place without measuring. While the floating UI shows, the bottom
// spacer never shrinks below the part of the stage it covers
// (--stage-chrome-h), which lifts the block just clear of it, and it drops
// back once the UI has faded out. A drop near the bottom docks the block
// (anchor 1), so it rides the UI's edge both ways. Only the drawn text is
// grabbable; a click on it without a drag opens the rail's style panel (a
// finger's tap goes on to the stage), and a press beside or between its lines
// goes to the stage
export const DraggableLyrics = ({
  children,
  layout,
  scale,
  backdrop,
  colors,
  wide = false,
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
    const stage = block.closest('[data-player-stage]')
    if (event.pointerType !== 'mouse' && stage !== null) {
      layout.pressStage(event.pointerType, fractionAcross(event, stage))
    }
    // Start from where the block is drawn, which is above the saved anchor
    // while the controls lift it
    const room = layer.clientHeight - block.offsetHeight
    dragRef.current = {
      anchor: room > 0 ? clamp01(block.offsetTop / room) : anchor,
      moved: false,
      pointerY: pagePoint(event).y,
      range: Math.max(1, room),
      slop:
        event.pointerType === 'mouse' ? TAP_SLOP_PX.mouse : TAP_SLOP_PX.touch,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) {
      return
    }
    const delta = pagePoint(event).y - drag.pointerY
    if (!drag.moved) {
      if (Math.abs(delta) < drag.slop) {
        return
      }
      drag.moved = true
      layout.onDragChange(true)
    }
    setDragAnchor(clamp01(drag.anchor + delta / drag.range))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || (event.type === 'pointercancel' && !drag.moved)) {
      return
    }
    if (drag.moved) {
      const block = blockRef.current
      const layer = block?.parentElement
      // The floating UI is hidden while dragging, so the spacer under the block (the lift) is down to its
      // floor, the home indicator's inset: what it has over that is the gap to the lowest the block can go
      const lift = block?.nextElementSibling
      const docked =
        block !== null &&
        layer !== null &&
        layer !== undefined &&
        lift instanceof HTMLElement &&
        lift.offsetHeight -
          // oxlint-disable-next-line unicorn/prefer-number-coercion -- the value ends in px, which Number() rejects
          Number.parseFloat(getComputedStyle(lift).minHeight) <=
          layer.clientHeight * DOCK_REACH
      setSavedAnchor(docked ? 1 : anchor)
      setDragAnchor(null)
      layout.onDragChange(false)
      // A drag that ends over the video must not also count as a tap on it
      swallowNextClick()
    } else if (event.pointerType === 'mouse') {
      setStylePanel('pinned')
    } else {
      // On a phone the lyrics are mostly over or beside the video, so a tap there does what a tap on the
      // video does (show or hide the controls, double-tap to skip). The style panel opens from its button
      layout.tapStage()
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
    // With the floating UI away, the lyrics still keep clear of the home indicator
    '--lift-min-h': layout.controlsVisible
      ? 'var(--stage-chrome-h)'
      : 'var(--safe-bottom, 0px)',
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
            'lyrics-hit-text mx-auto max-w-full cursor-grab touch-none rounded-xl px-cqw ring-white/25 transition-surface hover:bg-white/5 hover:ring-1',
            wide ? 'w-full' : 'w-fit',
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
