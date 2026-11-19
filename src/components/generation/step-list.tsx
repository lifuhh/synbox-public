import {
  CheckIcon,
  CircleIcon,
  LoaderCircleIcon,
  TriangleAlert,
} from 'lucide-react'

import { STEPS } from '@/lib/generation/plan'
import type { StepView } from '@/lib/generation/progress'
import { cn } from '@/utils/cn'

import ProgressBar from './progress-bar'

// A plain line icon in the text colour, never a tinted chip: done is a check, the running step a spinner (still under
// Reduce Motion; its bar still moves), a waiting step an empty ring
const Glyph = ({ view, failed }: { view: StepView; failed: boolean }) => {
  if (failed) {
    return <TriangleAlert aria-hidden className='size-4 shrink-0 text-error' />
  }
  if (view.state === 'done') {
    return (
      <CheckIcon
        aria-hidden
        className='size-4 shrink-0 text-muted-foreground'
      />
    )
  }
  if (view.state === 'active') {
    return (
      <LoaderCircleIcon
        aria-hidden
        className='size-4 shrink-0 text-foreground motion-safe:animate-spin'
      />
    )
  }
  return <CircleIcon aria-hidden className='size-3.5 shrink-0 text-faint' />
}

// What the row says after its title: the running stage, or where a failed job stopped. Done and waiting rows say it
// with their icon and ink, and to a screen reader in words
const rowDetail = (view: StepView, stopped: boolean) => {
  if (stopped) {
    return 'Stopped Here'
  }
  if (view.state === 'active') {
    return view.detail ?? 'Starting…'
  }
  return null
}

// The job's steps, all six in a flat list at their own height, so the card ends where its last step does: done
// steps grey with a check, the running one in full ink with its stage and its bar, the rest faint. The panel above
// shows the one percentage, the job's overall
const StepList = ({
  views,
  index,
  failed,
}: {
  views: readonly StepView[]
  index: number
  failed: boolean
}) => (
  <ol aria-label='Steps' className='flex flex-col'>
    {STEPS.map((step, i) => {
      const view = views[i]
      const current = i === index
      const stopped = current && failed
      const detail = rowDetail(view, stopped)
      return (
        <li
          key={step.id}
          className={cn(
            'flex h-9 items-center gap-3',
            view.state === 'done' && 'text-muted-foreground',
            view.state === 'pending' && !stopped && 'text-faint',
            current && 'text-foreground'
          )}>
          <span className='flex size-4 shrink-0 items-center justify-center'>
            <Glyph view={view} failed={stopped} />
          </span>
          <span className='shrink-0 text-label leading-5 font-semibold tracking-tight'>
            {step.title}
          </span>
          {view.state === 'done' && <span className='sr-only'>Done</span>}
          {view.state === 'pending' && !stopped && (
            <span className='sr-only'>Waiting</span>
          )}
          {detail !== null && (
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-right text-sm leading-5',
                stopped ? 'text-error-soft' : 'text-muted-foreground'
              )}>
              {detail}
            </span>
          )}
          {current && !stopped && view.state === 'active' && (
            <ProgressBar
              fraction={view.fraction}
              active
              className='h-1.5 w-16 shrink-0'
            />
          )}
        </li>
      )
    })}
  </ol>
)

export default StepList
