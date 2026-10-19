import { Check, TriangleAlert } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

import { STEPS } from '@/lib/generation/plan'
import type { StepView } from '@/lib/generation/progress'
import { cn } from '@/utils/cn'

import ProgressBar from './ProgressBar'

const ROW_H = 60
// Rows further from the center sit closer together and turn away, like a picker drum
const ROW_SPACING = [0, 50, 86]
const ROW_TILT = 26
const ROW_OPACITY = [1, 0.42, 0.14]

const place = (offset: number, reduced: boolean) => {
  const distance = Math.min(Math.abs(offset), ROW_SPACING.length - 1)
  const sign = Math.sign(offset)
  const hidden = Math.abs(offset) >= ROW_SPACING.length
  return {
    opacity: hidden ? 0 : ROW_OPACITY[distance],
    rotateX: reduced ? 0 : -sign * distance * ROW_TILT,
    scale: 1 - distance * 0.07,
    y:
      sign *
      (hidden
        ? ROW_SPACING[ROW_SPACING.length - 1] + 40
        : ROW_SPACING[distance]),
  }
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

// The job's steps on a drum: the current one in the band at the center with its bar and percentage,
// finished ones rolled up out of the way, the rest waiting below.
const StepWheel = ({ views, index, failed }: StepWheelProps) => {
  const reduced = useReducedMotion() ?? false
  return (
    <div
      className='relative h-[208px] overflow-hidden mask-[linear-gradient(to_bottom,transparent,black_28%,black_72%,transparent)] perspective-[700px]'
      aria-hidden>
      <div
        className='absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-xl bg-white/[0.055] ring-1 ring-white/10 ring-inset'
        style={{ height: ROW_H }}
      />
      {STEPS.map((step, i) => {
        const view = views[i]
        const offset = i - index
        const centered = offset === 0
        const shownFraction = centered
          ? view.fraction
          : view.state === 'done'
            ? 1
            : 0
        const percent = Math.floor(shownFraction * 100)
        return (
          <motion.div
            key={step.id}
            className='absolute inset-x-0 top-1/2 flex items-center gap-3 px-3 transform-3d'
            style={{ height: ROW_H, marginTop: -ROW_H / 2 }}
            initial={false}
            animate={place(offset, reduced)}
            transition={
              reduced
                ? { duration: 0 }
                : { damping: 22, mass: 0.9, stiffness: 160, type: 'spring' }
            }>
            <Glyph view={view} failed={centered && failed} />
            <div className='min-w-0 flex-1'>
              <p
                className={cn(
                  'truncate text-[15px] leading-5 font-semibold tracking-tight',
                  centered ? 'text-white' : 'text-white/80'
                )}>
                {step.title}
              </p>
              <p
                className={cn(
                  'truncate text-xs leading-4 text-white/55 transition-opacity duration-300',
                  centered ? 'opacity-100' : 'opacity-0'
                )}>
                {failed
                  ? 'Stopped here'
                  : view.state === 'done'
                    ? 'Done'
                    : view.slow
                      ? 'Taking longer than usual…'
                      : (view.detail ?? 'Up next')}
              </p>
            </div>
            <div
              className={cn(
                'flex w-24 flex-col items-end gap-1.5 transition-opacity duration-300',
                centered ? 'opacity-100' : 'opacity-0'
              )}>
              <span className='text-[15px] leading-none font-semibold text-white tabular-nums'>
                {percent}
                <span className='ml-px text-[11px] text-white/55'>%</span>
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
