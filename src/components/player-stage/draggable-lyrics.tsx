import { useAtom, useSetAtom } from 'jotai'
import type { WritableAtom } from 'jotai'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  lyricsAnchorAtom,
  lyricsAnchorPortraitAtom,
  lyricsPositionsDraggedAtom,
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
// stage, not pixels (the same few pixels are a finger's width on a phone and nothing on a desktop), with a floor.
// Karaoke Style's translation and rows replace it on the sides that face each other (globals.css ›
// lyric-stagger-translation-area)
const EDGE = 'max(0.5rem, 2cqh)'

const swallow = (event: MouseEvent) => {
  event.stopPropagation()
  event.preventDefault()
}

export const swallowNextClick = () => {
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => {
    window.removeEventListener('click', swallow, { capture: true })
  }, CLICK_AFTER_DRAG_MS)
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

// The least room under the block. While it is dragged, only the edge: it goes where the pointer puts it, the
// floor included. Dropped, it keeps clear of the home indicator. The floating UI never moves it: the controls
// and the rail draw over the lyrics while they show
const liftMinHeight = (lifts: boolean, dragging: boolean) => {
  if (!lifts) {
    return '0px'
  }
  return dragging ? EDGE : `max(var(--safe-bottom, 0px), ${EDGE})`
}

interface SpacerState {
  floor: boolean
  anchor: number
  lifts: boolean
  // Dragged or put somewhere at once: no ease
  still: boolean
  // Dragged to the edge, below the home indicator's room
  toEdge: boolean
}

// The spacers above and below the block split the free space by the anchor. Floor-anchored, the one above takes
// whatever the block leaves and the one below places the floor (globals.css › lyrics-floor); dragged, the block
// stands where it will rest, so the drop moves nothing
const spacersOf = ({ floor, anchor, lifts, still, toEdge }: SpacerState) => {
  if (floor) {
    return {
      grow: 1,
      growTransition: 'none',
      liftMin: liftMinHeight(lifts, false),
      liftTransition: still ? 'none' : `--rows-anchor ${LIFT_MS}ms ease-out`,
    }
  }
  const settle = still ? 'none' : `flex-grow ${LIFT_MS}ms ease-out`
  return {
    grow: anchor,
    growTransition: settle,
    liftMin: liftMinHeight(lifts, toEdge),
    // A drop settles from the drag's edge onto the home indicator's
    liftTransition: still
      ? 'none'
      : `min-height ${LIFT_MS}ms ease-out, ${settle}`,
  }
}

interface DragStart {
  pointerY: number
  slop: number
  anchor: number
  // Where the pointer asks the block to be, before `dock.confine` keeps it out of the other block
  asked: number
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
  // Karaoke Style's translation and rows, which dock together when one is let go over the other: `over` says whether
  // the place the pointer asks for is over the other, `confine` (the translation's) where the block may stand for it
  // (never over the rows), `onOver` as the drag crosses onto the other or off, `onDrop` when it is let go, with
  // whether it was over the other and its handle
  dock?: Dock
  // Drawn as the drop target: the other block is dragged over this one
  targeted?: boolean
  // False while the block is put somewhere at once (Karaoke Style's translation pulled off the rows): no ease
  eases?: boolean
  // Whether a drag may take it down to the edge, below the home indicator's room, settling there on the drop. Off,
  // it stands while dragged where it will rest, so the drop moves nothing
  dragToEdge?: boolean
  // Karaoke Style's rows: the anchor places their floor (`[data-lyric-floor]`'s bottom, the lower line's romaji), not
  // the block, so a block that grows or shrinks with its lines never moves the floor (floorTrackIn)
  floor?: boolean
}

export interface Dock {
  over: (asked: number, handle: HTMLElement) => boolean
  confine?: (asked: number, handle: HTMLElement) => number | null
  onOver: (over: boolean) => void
  onDrop: (over: boolean, handle: HTMLElement) => void
}

// An element's top within an ancestor, in layout: the page's own axes, which a page turned by Lock Landscape keeps
export const offsetIn = (element: HTMLElement, ancestor: HTMLElement) => {
  let top = 0
  let at: Element | null = element
  while (at instanceof HTMLElement && at !== ancestor) {
    top += at.offsetTop
    at = at.offsetParent
  }
  return top
}

// Where a block's handle can go: its top from the lyrics' layer's top is `base + anchor * free`, as the block
// reads its anchor on a press (the spacers' least heights aside)
export const handleTrack = (handle: HTMLElement, layer: HTMLElement) => {
  const block = handle.closest<HTMLElement>('.player-lyrics-overlay')
  const room = block?.parentElement
  if (!(block && room)) {
    return null
  }
  return {
    base: offsetIn(room, layer) + handle.offsetTop,
    free: Math.max(1, room.clientHeight - block.offsetHeight),
  }
}

// oxlint-disable-next-line unicorn/prefer-number-coercion -- the value ends in px, which Number() rejects
const pixels = (value: string) => Number.parseFloat(value) || 0

// Where a floor-anchored block's floor can go, within its room: `base + anchor * free`. At 0 a one-row pair
// (--rows-home, set by the rows) stands under the top edge; at 1 the floor stands on the room kept at the foot. The
// same sums as globals.css › lyrics-floor, which places it
const floorTrackIn = (block: HTMLElement) => {
  const room = block.parentElement
  const above = block.previousElementSibling
  const below = block.nextElementSibling
  if (!(room && above instanceof Element && below instanceof Element)) {
    return null
  }
  const pad = getComputedStyle(block)
  const under = getComputedStyle(below)
  const base =
    pixels(getComputedStyle(above).minHeight) +
    pixels(pad.paddingTop) +
    pixels(under.getPropertyValue('--rows-home'))
  return {
    base,
    free: Math.max(
      1,
      room.clientHeight -
        base -
        pixels(pad.paddingBottom) -
        pixels(under.minHeight)
    ),
  }
}

// A floor-anchored block's floor as drawn, within its room, and its track; null for a block placed by its top
const floorOf = (block: HTMLElement) => {
  const floor = block.dataset.anchorFloor === undefined ? null : block
  const line = floor?.querySelector<HTMLElement>('[data-lyric-floor]')
  const track = floor && floorTrackIn(floor)
  const room = block.parentElement
  return line && track && room
    ? { at: offsetIn(line, room) + line.offsetHeight, track }
    : null
}

// The track of the rows' floor, from their handle: how far it can travel (`free`), for a place kept under it
export const floorTrackOf = (handle: HTMLElement) => {
  const block = handle.closest<HTMLElement>('.player-lyrics-overlay')
  return block ? (floorOf(block)?.track ?? null) : null
}

// The anchor that puts a block's handle's top at `top` within the layer, at the handle's height now: the share of
// its track, by its top or, floor-anchored, by its floor
export const anchorForTop = (
  handle: HTMLElement,
  layer: HTMLElement,
  top: number
) => {
  const block = handle.closest<HTMLElement>('.player-lyrics-overlay')
  const floor = block ? floorOf(block) : null
  if (floor) {
    const moved = top - offsetIn(handle, layer)
    return clamp01((floor.at + moved - floor.track.base) / floor.track.free)
  }
  const track = handleTrack(handle, layer)
  return track ? clamp01((top - track.base) / track.free) : null
}

// `anchor` is where the viewer put the lyrics (0 = top, 1 = bottom of their
// area) and is what persists, once per drop. Flex spacers split the free
// space above and below the block by the anchor, so a taller or shorter line
// keeps its place without measuring. Karaoke Style's rows (`floor`) are placed
// by their floor instead: the spacer below is the floor's height over the foot
// (globals.css › lyrics-floor), and their block grows up from it. A drag goes anywhere between the edges,
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
  dock,
  targeted = false,
  eases = true,
  dragToEdge = true,
  floor = false,
}: DraggableLyricsProps) => {
  const lyricsAnchor = usePortrait()
    ? lyricsAnchorPortraitAtom
    : lyricsAnchorAtom
  const [savedAnchor, setSavedAnchor] = useAtom(anchorAtom ?? lyricsAnchor)
  // Where the block follows the pointer during a drag; saved on the drop, not on every move
  const [dragAnchor, setDragAnchor] = useState<number | null>(null)
  const anchor = dragAnchor ?? savedAnchor
  const dragging = dragAnchor !== null
  // Whether the block, where the drag has it now, is over the rows (dock only)
  const [over, setOver] = useState(false)
  const blockRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragStart | null>(null)
  const setStylePanel = useSetAtom(lyricsStylePanelAtom)
  const setDragged = useSetAtom(lyricsPositionsDraggedAtom)

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
    // heights (and, floor-anchored, a pair pushed down from the top or up by a docked translation) can keep off the
    // saved anchor
    const placed = floorOf(block)
    const room = placed?.track.free ?? layer.clientHeight - block.offsetHeight
    let from = room > 0 ? clamp01(block.offsetTop / room) : anchor
    if (placed) {
      from = clamp01((placed.at - placed.track.base) / placed.track.free)
    }
    dragRef.current = {
      anchor: from,
      asked: from,
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
    const handle = event.currentTarget
    drag.asked = clamp01(drag.anchor + delta / drag.range)
    // Nowhere it may stand for this place: it stays where it was drawn
    const placed = dock?.confine ? dock.confine(drag.asked, handle) : drag.asked
    setDragAnchor((current) => placed ?? current ?? drag.anchor)
    if (dock) {
      const now = dock.over(drag.asked, handle)
      if (now !== over) {
        setOver(now)
        dock.onOver(now)
      }
    }
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || (event.type === 'pointercancel' && !drag.moved)) {
      return
    }
    if (drag.moved) {
      // Where it was dropped is its place; dropped over the rows, it docks under them. The listener moved it, so
      // Lyrics Style offers Reset Positions
      setSavedAnchor(anchor)
      setDragged(true)
      setDragAnchor(null)
      if (dock) {
        // Where it was let go, not as of the last move
        const dropped = dock.over(drag.asked, event.currentTarget)
        setOver(false)
        dock.onOver(false)
        dock.onDrop(dropped, event.currentTarget)
      }
      layout.onDragChange(false)
      // A drag that ends over the video must not also count as a tap on it
      swallowNextClick()
    } else if (event.pointerType === 'mouse') {
      setStylePanel('pinned')
    } else {
      // On a phone the tap goes to the stage's taps: a double tap skips as on the video, a single tap opens
      // Lyrics Style (use-stage-taps)
      layout.tapStage()
    }
  }

  // Never while dragging: the block follows the pointer exactly
  const still = dragging || !eases
  const spacers = spacersOf({
    anchor,
    floor,
    lifts,
    still,
    toEdge: dragging && dragToEdge,
  })
  const anchorVars: CssVars = {
    '--anchor-grow': spacers.grow,
    '--anchor-min-h': EDGE,
    '--anchor-transition': spacers.growTransition,
  }
  const liftVars: CssVars = {
    '--anchor-min-h': EDGE,
    '--lift-grow': 1 - anchor,
    '--lift-min-h': spacers.liftMin,
    '--lift-transition': spacers.liftTransition,
    '--rows-anchor': anchor,
  }
  const blockVars: CssVars = {
    '--lyric-accent': colors.accent,
    '--lyric-glow': colors.glow,
    '--lyric-scale': scale,
  }
  return (
    // A block taller than the room overflows upward, over the video, never down off the stage
    <div className='pointer-events-none absolute inset-0 flex flex-col justify-end'>
      <div className='anchor-spacer' style={anchorVars} />
      <div
        ref={blockRef}
        data-anchor-floor={floor || undefined}
        className={cn(
          'player-lyrics-overlay relative isolate shrink-0 px-3 py-cqh select-none',
          children === undefined && 'invisible'
        )}
        style={blockVars}>
        <div
          data-testid='lyrics-handle'
          data-lyrics-style-toggle
          data-press-ok='drags the lyrics from the press; a tap acts on release'
          className={cn(
            'lyrics-hit-text mx-auto max-w-full cursor-grab touch-none rounded-xl px-cqw ring-white/25 transition-surface hover:bg-white/5 hover:ring-1 mouse:pointer-events-auto',
            wide ? 'w-full' : 'w-fit',
            dragging && 'cursor-grabbing bg-white/5 ring-1',
            targeted && 'bg-white/10 ring-2 ring-white/60'
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}>
          {children}
        </div>
      </div>
      <div
        className={floor ? 'lyrics-floor' : 'lyrics-lift'}
        style={liftVars}
      />
    </div>
  )
}
