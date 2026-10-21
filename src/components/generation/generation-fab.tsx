import { Check } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'

import { STEPS } from '@/lib/generation/plan'
import type { Job } from '@/lib/generation/store'
import { setGenerationExpanded } from '@/lib/generation/store'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import {
  FAB_MOTION,
  outcomeOf,
  queueLabelOf,
  surfacePlacement,
} from './surface'
import type { Presentation } from './use-presentation'

// The corner button's ring runs along its 52 px edge. Docked in the top bar, a 28 px ring sits in the same
// 40 px box as the icons beside it, as light as their 24 px glyphs. The dot at the ring's tip is r from the
// centre (its box's corner 2 px off); --fab-size, --fab-dot-x and --fab-dot-y are set as classes
const ringOf = (
  size: number,
  diameter: number,
  stroke: number,
  sizes: string
) => {
  const r = (diameter - stroke) / 2
  return { c: 2 * Math.PI * r, r, size, sizes, stroke }
}
const CORNER = ringOf(
  52,
  52,
  3,
  '[--fab-dot-x:48.5px] [--fab-dot-y:24px] [--fab-size:52px]'
)
const DOCK = ringOf(
  40,
  28,
  2,
  '[--fab-dot-x:31px] [--fab-dot-y:18px] [--fab-size:40px]'
)
// Trims the line box to the digits' cap height, so they center on the ring rather than on the font's box
const CAP_CENTERED = '[text-box:trim-both_cap_alphabetic] leading-none'

type FabState = 'running' | 'finishing' | 'done' | 'failed'

const fabState = (job: Job, view: Presentation): FabState => {
  if (job.status.kind === 'failed') {
    return 'failed'
  }
  if (view.revealed) {
    return 'done'
  }
  if (view.complete) {
    return 'finishing'
  }
  return 'running'
}

const LABELS: Record<Exclude<FabState, 'running'>, [string, string]> = {
  done: ['Ready to Sing', 'Open to play'],
  failed: ['Generation Failed', 'Open for details'],
  finishing: ['Finishing Up', 'Saving your song'],
}

// The minimized job: one ring along the button's edge that fills with the overall progress, a softly
// pulsing dot at its tip, and the number at the center. Hovering or focusing it slides out the current
// step; when the job ends the label stays out, so the result is noticed without opening anything.
interface GenerationFabProps {
  job: Job
  // Songs in this tab's list, shown on a badge when there is more than one
  count: number
  view: Presentation
  raised: boolean
  // In the top bar (phones) instead of the corner: the ring alone, the label in its accessible name
  docked: boolean
}

const GenerationFab = ({
  job,
  count,
  view,
  raised,
  docked,
}: GenerationFabProps) => {
  const ring = docked ? DOCK : CORNER
  const state = fabState(job, view)
  const percent = Math.floor(view.overall * 100)
  const step = view.views[view.index]
  const queueLabel = queueLabelOf(job)
  const labels = (): [string, string] => {
    if (state === 'running') {
      if (view.reconnecting) {
        return [STEPS[view.index].title, `${percent}% · Reconnecting…`]
      }
      return [
        STEPS[view.index].title,
        queueLabel ??
          `${percent}% · ${
            step.state === 'done' ? 'Done' : (step.detail ?? 'Starting')
          }`,
      ]
    }
    if (state === 'done') {
      return [outcomeOf(job)?.title ?? LABELS.done[0], LABELS.done[1]]
    }
    return LABELS[state]
  }
  const [title, detail] = labels()
  let spoken = detail
  if (state === 'running') {
    spoken = view.reconnecting ? `${percent}%, reconnecting` : `${percent}%`
  }
  const badge = () => {
    if (state === 'done') {
      return (
        <motion.span
          key='done'
          className='col-start-1 row-start-1 grid place-items-center text-white'
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ damping: 12, stiffness: 300, type: 'spring' }}>
          {/* Lucide's check sits half a pixel high in its box */}
          <Check
            className={cn(
              'translate-y-[0.5px]',
              docked ? 'size-3.5' : 'size-5'
            )}
            strokeWidth={3}
            aria-hidden
          />
        </motion.span>
      )
    }
    if (state === 'failed') {
      return (
        <motion.span
          key='failed'
          className={cn(
            'col-start-1 row-start-1 font-bold text-error',
            docked ? 'text-caption' : 'text-lg',
            CAP_CENTERED
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}>
          !
        </motion.span>
      )
    }
    return (
      <motion.span
        key='percent'
        exit={{ opacity: 0, scale: 0.6 }}
        className={cn(
          'col-start-1 row-start-1 font-semibold text-white tabular-nums',
          CAP_CENTERED,
          // Measured: at 15 px the digits land half a pixel above the ring's center
          docked && 'text-badge',
          !docked &&
            (percent === 100
              ? 'text-caption'
              : 'translate-y-[0.5px] text-label')
        )}>
        {percent}
      </motion.span>
    )
  }
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Focus comes back here from the panel. On a phone it follows a tap, and WebKit would still draw the
    // keyboard ring around it, the loudest thing in the top bar; the next Tab press shows it
    ref.current?.focus({ focusVisible: !docked, preventScroll: true })
  }, [docked])

  // The ring is drawn from 12 o'clock, so the dot's turn starts there too
  const turnVars: CssVars = {
    '--fab-turn': `rotate(${view.overall * 360 - 90}deg)`,
  }
  return (
    <motion.button
      ref={ref}
      type='button'
      {...FAB_MOTION}
      onClick={() => {
        setGenerationExpanded(true)
      }}
      aria-label={`Lyrics generation: ${title}, ${spoken}${count > 1 ? `, ${count} songs` : ''}. Open details`}
      className={cn(
        'group size-(--fab-size) rounded-full text-left outline-none',
        ring.sizes,
        docked
          ? 'pointer-events-auto relative shrink-0 focus-visible:ring-2 focus-visible:ring-brand-light'
          : cn(
              surfacePlacement(raised),
              'fixed z-50 origin-bottom-right drop-shadow-fab'
            )
      )}>
      {/* Spans the open label and the ring beneath it. It opens by clipping, and the text by sliding, never
          by resizing: the text is laid out once, and a transition cut short turns back from where it is */}
      {!docked && (
        <span
          className={cn(
            'absolute inset-y-0 right-0 flex w-max items-center rounded-full bg-generation-surface pr-(--fab-size) transition-clip duration-300 ease-out ring-inset group-focus-visible:ring-2 group-focus-visible:ring-brand-light',
            state === 'running'
              ? '[clip-path:inset(0_0_0_calc(100%-var(--fab-size))_round_9999px)] group-hover:[clip-path:inset(0_round_9999px)] group-focus-visible:[clip-path:inset(0_round_9999px)]'
              : '[clip-path:inset(0_round_9999px)]'
          )}>
          <span className='overflow-hidden'>
            <span
              className={cn(
                'block max-w-[min(15rem,calc(100vw-7rem))] pr-1 pl-5 transition-transform duration-300 ease-out',
                state === 'running' &&
                  'translate-x-full group-hover:translate-x-0 group-focus-visible:translate-x-0'
              )}>
              <span className='block truncate text-caption leading-4 font-semibold text-white'>
                {title}
              </span>
              <span className='block truncate text-xs leading-4 text-muted-foreground'>
                {detail}
              </span>
            </span>
          </span>
        </span>
      )}
      <span className='relative grid size-full place-items-center'>
        <svg
          viewBox={`0 0 ${ring.size} ${ring.size}`}
          className='absolute inset-0 -rotate-90'
          aria-hidden>
          <defs>
            <linearGradient id='fab-ring' x1='0' y1='0' x2='1' y2='1'>
              <stop offset='0%' stopColor='var(--color-brand-light)' />
              <stop offset='100%' stopColor='var(--color-brand-ring-stop)' />
            </linearGradient>
          </defs>
          <circle
            cx={ring.size / 2}
            cy={ring.size / 2}
            r={ring.r}
            fill='none'
            strokeWidth={ring.stroke}
            className='stroke-white/10'
          />
          <circle
            cx={ring.size / 2}
            cy={ring.size / 2}
            r={ring.r}
            fill='none'
            strokeWidth={ring.stroke}
            strokeLinecap='round'
            stroke={state === 'failed' ? 'rgb(248 113 113)' : 'url(#fab-ring)'}
            strokeDasharray={ring.c}
            strokeDashoffset={ring.c * (1 - view.overall)}
            className='transition-dashoffset duration-450 ease-out'
          />
        </svg>
        {state === 'running' && view.overall > 0.01 && (
          // Turns with the same timing as the arc, so the dot stays on its tip. It sits outside the SVG so its turn
          // and pulse can run on the compositor: inside the SVG, the turn re-laid out the page on every frame.
          // The dot's centre is R from the ring's centre (--fab-dot-x, --fab-dot-y: its corner, 2 px off).
          <span
            aria-hidden
            className='absolute inset-0 transform-(--fab-turn) transition-transform duration-450 ease-out'
            style={turnVars}>
            <span className='absolute top-(--fab-dot-y) left-(--fab-dot-x) size-1 rounded-full bg-white motion-safe:animate-breathe' />
          </span>
        )}
        {count > 1 && (
          <span
            aria-hidden
            className={cn(
              'absolute grid place-items-center rounded-full bg-brand-light leading-none font-semibold text-generation-surface tabular-nums',
              docked
                ? 'top-1 right-1 h-3.5 min-w-3.5 px-0.5 text-micro'
                : '-top-1 -right-1 h-[18px] min-w-[18px] px-1 text-badge'
            )}>
            {count}
          </span>
        )}
        <AnimatePresence mode='popLayout' initial={false}>
          {badge()}
        </AnimatePresence>
      </span>
    </motion.button>
  )
}

export default GenerationFab
