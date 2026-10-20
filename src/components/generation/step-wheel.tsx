import { Check, TriangleAlert } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { PointerEvent } from 'react'
import { useRef, useState } from 'react'

import { STEPS } from '@/lib/generation/plan'
import type { StepView } from '@/lib/generation/progress'

import ProgressBar from './progress-bar'

const ROW_H = 60
// Rows further from the center sit closer together and turn away, like a picker drum. The last level is
// out of sight, past the mask
const ROW_SPACING = [0, 50, 86, 126]
const ROW_TILT = 26
const ROW_OPACITY = [1, 0.42, 0.14, 0]
// Dragging this far moves the drum one step
const DRAG_STEP_PX = 50
// Past the first or last step the drum gives way at this fraction of the drag
const EDGE_GIVE = 0.3

// Linear between the levels, so a drag between steps moves every row smoothly
const level = (levels: readonly number[], distance: number) => {
  const below = Math.floor(distance)
  const above = Math.min(below + 1, levels.length - 1)
  return levels[below] + (levels[above] - levels[below]) * (distance - below)
}

// Where a row sits `offset` steps from the drum's centre; fractional while dragged
const place = (offset: number, reduced: boolean) => {
  const distance = Math.min(Math.abs(offset), ROW_SPACING.length - 1)
  const sign = Math.sign(offset)
  return {
    opacity: level(ROW_OPACITY, distance),
    rotateX: reduced ? 0 : -sign * distance * ROW_TILT,
    scale: 1 - distance * 0.07,
    y: sign * level(ROW_SPACING, distance),
  }
}

const SPRING = {
  damping: 22,
  mass: 0.9,
  stiffness: 160,
  type: 'spring',
} as const
// Stiff enough to sit under the finger, but continuous if a press lands mid-roll
const HELD = {
  damping: 60,
  mass: 0.4,
  stiffness: 1400,
  type: 'spring',
} as const

// Pressing and dragging the drum looks through every step. While held it never moves on its own, even
// when the job moves on; let go and it springs back to the step running now
const useDragFocus = (index: number, last: number) => {
  const [dragFocus, setDragFocus] = useState<number | null>(null)
  const dragRef = useRef<{ startY: number; anchor: number } | null>(null)

  const release = () => {
    dragRef.current = null
    setDragFocus(null)
  }
  const handlers = {
    onLostPointerCapture: release,
    onPointerCancel: release,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }
      // A mouse drag would otherwise select the panel's text above and below the drum
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = { anchor: index, startY: event.clientY }
      setDragFocus(index)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      const raw = drag.anchor - (event.clientY - drag.startY) / DRAG_STEP_PX
      const clamped = Math.min(Math.max(raw, 0), last)
      setDragFocus(clamped + (raw - clamped) * EDGE_GIVE)
    },
    onPointerUp: release,
  }
  return { dragging: dragFocus !== null, focus: dragFocus ?? index, handlers }
}

const Glyph = ({ view, failed }: { view: StepView; failed: boolean }) => {
  if (failed) {
    return (
      <span className='flex size-7 items-center justify-center rounded-full bg-destructive/25 text-red-300'>
        <TriangleAlert className='size-4' aria-hidden />
      </span>
    )
  }
  if (view.state === 'done') {
    return (
      <span className='flex size-7 items-center justify-center rounded-full bg-linear-to-br from-[#f785b3] to-primary text-white shadow-[0_0_12px_-2px_#eb6fce]'>
        <Check className='size-4' strokeWidth={3} aria-hidden />
      </span>
    )
  }
  const r = 11
  const c = 2 * Math.PI * r
  return (
    <svg viewBox='0 0 28 28' className='size-7 -rotate-90' aria-hidden>
      <circle
        cx='14'
        cy='14'
        r={r}
        className='fill-none stroke-white/12'
        strokeWidth='3'
      />
      {view.state === 'active' && (
        <circle
          cx='14'
          cy='14'
          r={r}
          className='fill-none stroke-[#f785b3] transition-[stroke-dashoffset] duration-450 ease-out'
          strokeWidth='3'
          strokeLinecap='round'
          strokeDasharray={c}
          strokeDashoffset={c * (1 - view.fraction)}
        />
      )}
    </svg>
  )
}

interface StepWheelProps {
  views: readonly StepView[]
  index: number
  failed: boolean
}

const rowTransition = (reduced: boolean, dragging: boolean) => {
  if (reduced) {
    return { duration: 0 }
  }
  return dragging ? HELD : SPRING
}

const rowDetail = (view: StepView, stopped: boolean) => {
  if (stopped) {
    return 'Stopped here'
  }
  if (view.state === 'done') {
    return 'Done'
  }
  if (view.state === 'pending') {
    return 'Waiting'
  }
  return view.detail ?? 'Starting…'
}

// The job's steps on a drum: the current one in the band at the center, finished ones rolled up out of the
// way, the rest waiting below. Rows are rigid, so a roll only moves them: nothing in a row fades or swaps
// as it is centered, which would empty the band halfway through every roll.
const StepWheel = ({ views, index, failed }: StepWheelProps) => {
  const reduced = useReducedMotion() ?? false
  const { dragging, focus, handlers } = useDragFocus(index, STEPS.length - 1)
  return (
    <div
      {...handlers}
      className='relative h-[208px] cursor-grab touch-none overflow-hidden mask-[linear-gradient(to_bottom,transparent,black_28%,black_72%,transparent)] select-none perspective-[700px] active:cursor-grabbing'
      aria-hidden>
      <div
        className='absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-xl bg-white/[0.055] ring-1 ring-white/10 ring-inset'
        style={{ height: ROW_H }}
      />
      {STEPS.map((step, i) => {
        const view = views[i]
        const offset = i - index
        const centered = offset === 0
        const restingFraction = view.state === 'done' ? 1 : 0
        const shownFraction = centered ? view.fraction : restingFraction
        const percent = Math.floor(shownFraction * 100)
        return (
          <motion.div
            key={step.id}
            className='absolute inset-x-0 top-1/2 flex items-center gap-3 px-3 transform-3d'
            style={{ height: ROW_H, marginTop: -ROW_H / 2 }}
            initial={false}
            animate={place(i - focus, reduced)}
            transition={rowTransition(reduced, dragging)}>
            <Glyph view={view} failed={centered && failed} />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-[15px] leading-5 font-semibold tracking-tight text-white'>
                {step.title}
              </p>
              <p className='truncate text-xs leading-4 text-white/55'>
                {rowDetail(view, centered && failed)}
              </p>
            </div>
            <div className='flex w-24 flex-col items-end gap-1.5'>
              <span className='text-[15px] leading-none font-semibold text-white tabular-nums'>
                {percent}
                <span className='ml-px text-xs text-white/55'>%</span>
              </span>
              <ProgressBar
                fraction={shownFraction}
                active={centered && view.state === 'active' && !failed}
                failed={centered && failed}
                className='h-1.5 w-full'
              />
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

export default StepWheel
