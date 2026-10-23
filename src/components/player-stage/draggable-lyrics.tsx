import { useAtom, useSetAtom } from 'jotai'
import type { WritableAtom } from 'jotai'
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

// How far a press must travel to count as a drag: a fingertip rolls further than a mouse wobbles
const TAP_SLOP_PX = { mouse: 4, touch: 10 }
const LIFT_MS = 200
const CLICK_AFTER_DRAG_MS = 400
// The least room kept above and below the block, so lyrics dragged to an edge never sit on it: a share of the
// stage, not pixels (the same few pixels are a finger's width on a phone and nothing on a desktop), with a floor
const EDGE = 'max(0.5rem, 2cqh)'

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

// The least room under the block. While it is dragged, only the edge: it goes where the pointer puts it, the
// floor included. Dropped, it keeps clear of the home indicator. The floating UI never moves it: the controls
// and the rail draw over the lyrics while they show
const liftMinHeight = (lifts: boolean, dragging: boolean) => {
  if (!lifts) {
    return '0px'
  }
  return dragging ? EDGE : `max(var(--safe-bottom, 0px), ${EDGE})`
}

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
  colors: LyricsThemeColors
  // The whole width to lay out in (Two Lines' left and right lines), instead of a centred fit
  wide?: boolean
  // Where the block's place is saved, when not the lyrics' own (Two Lines' translation keeps its own)
  anchorAtom?: WritableAtom<number, [number], void>
  // Whether the block keeps clear of the home indicator; a block at the top of the stage has nothing to clear
  lifts?: boolean
}

// `anchor` is where the viewer put the lyrics (0 = top, 1 = bottom of their
// area) and is what persists, once per drop. Flex spacers split the free
// space above and below the block by the anchor, so a taller or shorter line
// keeps its place without measuring. A drag goes anywhere between the edges,
// the floor included. The controls showing or hiding never moves the block:
// they draw over it. Only the drawn text is
// grabbable; a click on it without a drag opens the rail's style panel (a
// finger's tap goes on to the stage), and a press beside or between its lines
// goes to the stage
export const DraggableLyrics = ({
  children,
  layout,
  scale,
  colors,
  wide = false,
  anchorAtom,
  lifts = true,
}: DraggableLyricsProps) => {
  const lyricsAnchor = usePortrait()
    ? lyricsAnchorPortraitAtom
    : lyricsAnchorAtom
  const [savedAnchor, setSavedAnchor] = useAtom(anchorAtom ?? lyricsAnchor)
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
    // Start from where the block is drawn, which the spacers' minimum
    // heights can keep off the saved anchor
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
      // Where it was dropped is its place
      setSavedAnchor(anchor)
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
    '--anchor-min-h': EDGE,
    '--anchor-transition': settle,
  }
  const blockVars: CssVars = {
    '--lyric-accent': colors.accent,
    '--lyric-glow': colors.glow,
    '--lyric-scale': scale,
  }
  const liftVars: CssVars = {
    '--lift-grow': 1 - anchor,
    '--lift-min-h': liftMinHeight(lifts, dragging),
    // A drop settles from the drag's edge onto the home indicator's
    '--lift-transition': dragging
      ? 'none'
      : `min-height ${LIFT_MS}ms ease-out, ${settle}`,
  }
  return (
    // A block taller than the room overflows upward, over the video, never down off the stage
    <div className='pointer-events-none absolute inset-0 flex flex-col justify-end'>
      <div className='anchor-spacer' style={anchorVars} />
      <div
        ref={blockRef}
        className={cn(
          'player-lyrics-overlay relative isolate shrink-0 px-3 py-cqh select-none',
          children === undefined && 'invisible'
        )}
        style={blockVars}>
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
