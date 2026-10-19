import { Check, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'

import { STEPS } from '@/lib/generation/plan'
import type { Job } from '@/lib/generation/store'
import { setGenerationExpanded } from '@/lib/generation/store'
import { cn } from '@/utils/cn'

import {
  hideBrokenImage,
  hidePlaceholderImage,
  SURFACE_LAYOUT_ID,
  SURFACE_SPRING,
  thumbnailOf,
} from './surface'
import type { Presentation } from './usePresentation'

const SIZE = 48
const STROKE = 3
const R = (SIZE - STROKE) / 2 - 1
const C = 2 * Math.PI * R

type FabState = 'running' | 'finishing' | 'done' | 'failed'

const fabState = (job: Job, view: Presentation): FabState => {
  if (job.status.kind === 'failed') return 'failed'
  if (view.revealed) return 'done'
  if (view.complete) return 'finishing'
  return 'running'
}

const LABELS: Record<Exclude<FabState, 'running'>, [string, string]> = {
  done: ['Lyrics Ready', 'Open to play'],
  failed: ['Generation Failed', 'Open for details'],
  finishing: ['Finishing Up', 'Saving your song'],
}

// The minimized job: the song's cover turning like a record inside a ring that fills with the overall
// progress, the percentage at its center. Hovering or focusing it slides out the current step; when the
// job ends the label stays out, so the result is noticed without opening anything.
const GenerationFab = ({ job, view }: { job: Job; view: Presentation }) => {
  const state = fabState(job, view)
  const percent = Math.floor(view.overall * 100)
  const step = view.views[view.index]
  const opaque =
    state === 'running' && step?.state === 'active' && !step.measured
  const [title, detail] =
    state === 'running'
      ? [
          STEPS[view.index].title,
          `${percent}% · ${
            step.state === 'done'
              ? 'Done'
              : step.slow
                ? 'Taking longer than usual'
                : (step.detail ?? 'Starting')
          }`,
        ]
      : LABELS[state]
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])

  return (
    <motion.button
      ref={ref}
      type='button'
      layoutId={SURFACE_LAYOUT_ID}
      transition={SURFACE_SPRING}
      style={{ borderRadius: 9999 }}
      onClick={() => {
        setGenerationExpanded(true)
      }}
      aria-label={`Lyrics generation: ${title}, ${state === 'running' ? `${percent}%` : detail}. Open details`}
      className='group fixed right-4 bottom-4 z-50 flex flex-row-reverse items-center border border-white/10 bg-[#1b0812]/90 p-1 text-left shadow-[0_12px_32px_-8px_rgb(0_0_0/0.7)] backdrop-blur-xl outline-none focus-visible:ring-2 focus-visible:ring-[#f785b3] sm:right-6 sm:bottom-6'>
      <span
        className='relative block shrink-0'
        style={{ height: SIZE, width: SIZE }}>
        <span className='absolute inset-[3px] overflow-hidden rounded-full bg-linear-to-br from-primary to-[#f785b3]'>
          <img
            key={thumbnailOf(job)}
            src={thumbnailOf(job)}
            alt=''
            onError={hideBrokenImage}
            onLoad={hidePlaceholderImage}
            className={cn(
              'size-full scale-[1.4] object-cover',
              state === 'running' && 'motion-safe:animate-vinyl'
            )}
          />
          {/* Grooves and a scrim that darkens towards the label, where the percentage sits */}
          <span className='absolute inset-0 bg-[repeating-radial-gradient(circle,transparent_0_1.5px,rgb(0_0_0/0.18)_1.5px_2.5px)]' />
          <span className='absolute inset-0 bg-[radial-gradient(circle,rgb(24_5_14/0.9)_30%,rgb(24_5_14/0.55)_62%,rgb(24_5_14/0.12)_100%)]' />
        </span>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className='absolute inset-0 -rotate-90'
          aria-hidden>
          <defs>
            <linearGradient id='fab-ring' x1='0' y1='0' x2='1' y2='1'>
              <stop offset='0%' stopColor='#f785b3' />
              <stop offset='100%' stopColor='hsl(329 95% 50%)' />
            </linearGradient>
          </defs>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill='none'
            strokeWidth={STROKE}
            className={cn(
              'stroke-white/15',
              opaque && 'motion-safe:animate-breathe'
            )}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill='none'
            strokeWidth={STROKE}
            strokeLinecap='round'
            stroke={state === 'failed' ? 'rgb(248 113 113)' : 'url(#fab-ring)'}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - view.overall)}
            className='drop-shadow-[0_0_3px_rgb(247_133_179/0.8)] transition-[stroke-dashoffset] duration-450 ease-out'
          />
        </svg>
        <span className='absolute inset-0 flex items-center justify-center text-white'>
          <AnimatePresence mode='popLayout' initial={false}>
            {state === 'done' ? (
              <motion.span
                key='done'
                initial={{ opacity: 0, scale: 0.3 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ damping: 12, stiffness: 300, type: 'spring' }}>
                <Check className='size-5' strokeWidth={3} aria-hidden />
              </motion.span>
            ) : state === 'failed' ? (
              <motion.span
                key='failed'
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}>
                <TriangleAlert className='size-5 text-red-300' aria-hidden />
              </motion.span>
            ) : (
              <motion.span
                key='percent'
                exit={{ opacity: 0, scale: 0.6 }}
                className={cn(
                  'font-semibold tabular-nums',
                  percent === 100 ? 'text-[13px]' : 'text-[15px]'
                )}>
                {percent}
                <span className='text-[9px] font-medium text-white/60'>%</span>
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        {state === 'done' && (
          <motion.span
            className='absolute inset-0 rounded-full ring-2 ring-[#f785b3]'
            initial={{ opacity: 0.8, scale: 1 }}
            animate={{ opacity: 0, scale: 1.6 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            aria-hidden
          />
        )}
      </span>
      <span
        className={cn(
          'grid transition-[grid-template-columns] duration-300 ease-out',
          state === 'running'
            ? 'grid-cols-[0fr] group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]'
            : 'grid-cols-[1fr]'
        )}>
        <span className='overflow-hidden'>
          <span className='block max-w-[min(15rem,calc(100vw-7rem))] pr-2 pl-3'>
            <span className='block truncate text-[13px] leading-4 font-semibold text-white'>
              {title}
            </span>
            <span className='block truncate text-[11px] leading-4 text-white/55'>
              {detail}
            </span>
          </span>
        </span>
      </span>
    </motion.button>
  )
}

export default GenerationFab
