import type { RefObject } from 'react'
import { use, useLayoutEffect, useRef } from 'react'

import { SwapIcon } from '@/components/svgicons'
import { reducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/utils/cn'

import { RailInline, RailTooltip } from './rail-button'

// The two buttons cross as an indicator travels (globals.css › --duration-indicator, --ease-travel), which the
// arrow's turn reads from the same tokens
const EXCHANGE_MS = 240
const TRAVEL = 'cubic-bezier(0.65, 0, 0.35, 1)'
// The least a turn back takes, however short its way: five frames
const TURN_BACK_MIN_MS = 80
// A turn back shorter than this is no move at all: one frame lands it
const SNAP_PX = 2
// Reduce Motion: no travel, a short fade where each button now stands
const FADE_MS = 150

// How far an element is drawn from its place right now, mid-move included
const drawnOffsetOf = (element: HTMLElement) => {
  const [x = '0', y = '0'] = getComputedStyle(element)
    .translate.replace('none', '0')
    .split(' ')
  // oxlint-disable-next-line unicorn/prefer-number-coercion -- the values end in px, which Number() rejects
  return { x: Number.parseFloat(x) || 0, y: Number.parseFloat(y) || 0 }
}

// Two buttons that trade what they hold when `order` changes: each keeps its place in the page (and so the focus
// and the tab order), takes the other's part, and is drawn from where that part stood to its own place. A change
// mid-move starts from where the two are drawn then, so nothing jumps. Transform only: nothing beside them moves
export const useExchange = (
  order: boolean,
  first: RefObject<HTMLElement | null>,
  second: RefObject<HTMLElement | null>
) => {
  const was = useRef(order)
  const running = useRef<Animation[]>([])
  useLayoutEffect(() => {
    const a = first.current
    const b = second.current
    if (was.current === order || !(a && b)) {
      was.current = order
      return
    }
    was.current = order
    const apart = {
      x: b.offsetLeft - a.offsetLeft,
      y: b.offsetTop - a.offsetTop,
    }
    const drawn = { a: drawnOffsetOf(a), b: drawnOffsetOf(b) }
    for (const animation of running.current) {
      animation.cancel()
    }
    if (reducedMotion()) {
      running.current = [a, b].map((button) =>
        button.animate({ opacity: [0.4, 1] }, FADE_MS)
      )
      return
    }
    // A press mid-move sends the two back over the part of the way they had come, in that share of the time, as
    // the arrow's own turn back does (a CSS transition reversed mid-way)
    const way = Math.hypot(apart.x + drawn.b.x, apart.y + drawn.b.y)
    // Pressed again before they had left (a frame or two in): they are back where they stand, as the cancel above
    // draws them. Even the shortest turn back would hold them within a hair of their place for its five frames
    if (way < SNAP_PX) {
      running.current = []
      return
    }
    const share = Math.min(1, way / Math.max(1, Math.hypot(apart.x, apart.y)))
    const duration = Math.max(TURN_BACK_MIN_MS, EXCHANGE_MS * share)
    const travel = (button: HTMLElement, x: number, y: number) => {
      const animation = button.animate(
        { translate: [`${x}px ${y}px`, '0px 0px'] },
        { duration, easing: TRAVEL }
      )
      animation.pause()
      return animation
    }
    const started = [
      travel(a, apart.x + drawn.b.x, apart.y + drawn.b.y),
      travel(b, drawn.a.x - apart.x, drawn.a.y - apart.y),
    ]
    running.current = started
    // Held at their start until the next frame: that frame draws each part exactly where it stood, however long
    // the change of order took to lay out (WebKit counted that time as travel: 3.7px in on the first frame)
    requestAnimationFrame(() => {
      for (const animation of started) {
        if (animation.playState === 'paused') {
          animation.play()
        }
      }
    })
  }, [order, first, second])
}

const SWAP = 'z-10 grid shrink-0 place-items-center rounded-full rail-swap'
// On the stage: no disc of its own, its glyph drawn on the video (globals.css › rail-swap-on-video: its ink, its
// hover, and its press target on a phone on its side). As large as the discs on a touch screen.
// It floats beside the pair, not in the rail: out of the rail's flow, centred on the seam between the two buttons,
// on the video's side of the column, 12px clear of the discs so its 44px press target keeps 8px from theirs. The
// rail upright is a row that scrolls sideways and so clips anything outside it: there it keeps a place between the
// two. It sits outside the rail's box, which slides off the screen to hide, so it fades as the rail goes
const ON_STAGE = cn(
  'rail-swap-on-video absolute top-1/2 left-full ms-3 size-8 -translate-y-1/2 touch:size-11 short:size-9',
  'portrait:relative portrait:top-auto portrait:left-auto portrait:ms-0 portrait:translate-y-0',
  'in-data-rail-closed:invisible in-data-rail-closed:opacity-0'
)
// In the row under the video: the page's ink and the row's own hover; as large as the row's discs on a touch screen
const IN_ROW =
  'relative size-8 text-muted-foreground hover:bg-accent hover:text-foreground touch:size-10'

// Beside the Translations and Romaji buttons (between them in a row): trades the two rows' places under each line,
// and the buttons' with them. `flipped`: the romaji comes first. Shown only while both rows show as rows under the
// line; otherwise it fades out where it stands, so no button beside it moves
export const RowSwap = ({
  flipped,
  shown,
  onSwap,
}: {
  flipped: boolean
  shown: boolean
  onSwap: () => void
}) => {
  const inline = use(RailInline)
  return (
    <RailTooltip label='Swap Romaji and Translations' hidden={!shown}>
      <button
        type='button'
        aria-label='Swap Romaji and Translations'
        onClick={onSwap}
        className={cn(
          SWAP,
          inline ? IN_ROW : ON_STAGE,
          !shown && 'pointer-events-none invisible opacity-0'
        )}>
        {/* The glyph is a U opening up, a head at each end. On the stage's column it floats to the pair's right, so
            a quarter turn back opens it to the left: each end points at one of the two buttons. Upright and in the
            row under the video it lies flat between them */}
        <span className={cn('grid', !inline && '-rotate-90 portrait:rotate-0')}>
          {/* A press turns it once round, one way and then back the other, so it always comes to rest facing the
              pair (a half turn left it facing away every other press) */}
          <SwapIcon
            aria-hidden
            className={cn(
              'size-5 transition-transform duration-(--duration-indicator) ease-travel motion-reduce:transition-none',
              flipped && 'rotate-360'
            )}
          />
        </span>
      </button>
    </RailTooltip>
  )
}
