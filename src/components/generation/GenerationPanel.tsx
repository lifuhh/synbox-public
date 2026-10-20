import { Check, Minus, Play, RotateCcw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { overallValue } from '@/lib/generation/progress'
import type { Job } from '@/lib/generation/store'
import {
  cancelGeneration,
  dismissGeneration,
  focusGeneration,
  isActive,
  retryGeneration,
  setGenerationExpanded,
  startGeneration,
} from '@/lib/generation/store'
import { cn } from '@/utils/cn'

import StepWheel from './StepWheel'
import {
  hideBrokenImage,
  hidePlaceholderImage,
  outcomeOf,
  PANEL_MOTION,
  queueLabelOf,
  surfacePlacement,
  thumbnailOf,
  titleOf,
} from './surface'
import type { Presentation } from './usePresentation'

const timeLeft = (seconds: number) => {
  if (seconds < 20) {
    return 'Almost there'
  }
  if (seconds < 60) {
    return 'Less than a minute left'
  }
  const minutes = Math.round(seconds / 60)
  return `About ${minutes} min left`
}

const SongHeader = ({ job, onClose }: { job: Job; onClose: () => void }) => {
  const running = isActive(job)
  const title = titleOf(job)
  const channel = job.video?.channel ?? ''
  const subtitle =
    channel !== ''
      ? channel
      : running
        ? job.mode === 'regenerate'
          ? 'Regenerating Lyrics'
          : 'Generating Lyrics'
        : ''
  return (
    <div className='flex items-center gap-3'>
      <span className='h-10 w-[71px] shrink-0 overflow-hidden rounded-md bg-linear-to-br from-primary to-[#f785b3] ring-1 ring-white/10'>
        <img
          key={thumbnailOf(job)}
          src={thumbnailOf(job)}
          alt=''
          onError={hideBrokenImage}
          onLoad={hidePlaceholderImage}
          className='size-full object-cover'
        />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-semibold text-white'>
          {title === '' ? 'Fetching Song Details…' : title}
        </p>
        {subtitle !== '' && (
          <p className='truncate text-xs text-white/55'>{subtitle}</p>
        )}
      </div>
      <Button
        variant='ghost'
        size='icon'
        className='size-8 shrink-0 rounded-full text-white/70 hover:bg-white/10 hover:text-white touch:size-10'
        aria-label={running ? 'Minimize' : 'Close'}
        onClick={onClose}>
        {running ? <Minus className='size-4' /> : <X className='size-4' />}
      </Button>
    </div>
  )
}

const DoneView = ({ job }: { job: Job }) => {
  const outcome = outcomeOf(job)
  if (!outcome) {
    return null
  }
  const close = () => {
    dismissGeneration(job.id)
  }
  return (
    <motion.div
      key='done'
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className='flex flex-col items-center gap-4 pt-3 text-center'>
      <motion.span
        initial={{ rotate: -20, scale: 0.4 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ damping: 12, stiffness: 260, type: 'spring' }}
        className='flex size-12 items-center justify-center rounded-full bg-linear-to-br from-[#f785b3] to-primary text-white shadow-[0_0_32px_-6px_#eb6fce]'>
        <Check className='size-6' strokeWidth={3} aria-hidden />
      </motion.span>
      <div className='space-y-1 px-2'>
        <p className='text-lg font-semibold text-white'>{outcome.title}</p>
        <p className='text-sm text-white/60'>{outcome.detail}</p>
      </div>
      <Button asChild className='w-full gap-2'>
        <Link to={outcome.play.to} onClick={close}>
          <Play className='size-4 fill-current' />
          {outcome.play.label}
        </Link>
      </Button>
      {(outcome.versions || !job.skipUploaderLyrics) && (
        <div className='flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-white/50'>
          {outcome.versions && (
            <Link
              to={`/v/${job.videoId}/versions`}
              onClick={close}
              className='underline-offset-4 hover:text-white/80 hover:underline'>
              See All Versions
            </Link>
          )}
          {!job.skipUploaderLyrics && (
            <button
              type='button'
              className='underline-offset-4 hover:text-white/80 hover:underline'
              onClick={() => {
                startGeneration({
                  mode: 'regenerate',
                  skipUploaderLyrics: true,
                  title: titleOf(job),
                  videoId: job.videoId,
                })
              }}>
              Lyrics look off? Try without the video&apos;s subtitles
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}

const rowStatus = (job: Job) => {
  const { status } = job
  if (status.kind === 'complete') {
    return 'Ready'
  }
  if (status.kind === 'failed') {
    return 'Failed'
  }
  return (
    queueLabelOf(job) ??
    `${Math.floor(overallValue(job.runs, Date.now(), false) * 100)}%`
  )
}

// Every song started from this tab, oldest first; picking one shows it in the panel
const SongQueue = ({
  jobs,
  focusedId,
}: {
  jobs: readonly Job[]
  focusedId: number
}) => (
  <div className='flex flex-col gap-1'>
    <p className='px-1 text-xs font-medium text-white/45'>
      Your Songs · {jobs.length}
    </p>
    <ul className='flex max-h-36 flex-col gap-0.5 overflow-y-auto'>
      {jobs.map((job) => {
        const title = titleOf(job)
        const failed = job.status.kind === 'failed'
        return (
          <li key={job.id}>
            <button
              type='button'
              aria-current={job.id === focusedId}
              onClick={() => {
                focusGeneration(job.id)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[#f785b3] touch:py-2',
                job.id === focusedId && 'bg-white/8'
              )}>
              <span className='h-6 w-[43px] shrink-0 overflow-hidden rounded bg-linear-to-br from-primary to-[#f785b3]'>
                <img
                  src={thumbnailOf(job)}
                  alt=''
                  onError={hideBrokenImage}
                  onLoad={hidePlaceholderImage}
                  className='size-full object-cover'
                />
              </span>
              <span className='min-w-0 flex-1 truncate text-xs text-white/85'>
                {title === '' ? job.videoId : title}
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  failed ? 'text-red-300' : 'text-white/55'
                )}>
                {rowStatus(job)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  </div>
)

interface GenerationPanelProps {
  job: Job
  jobs: readonly Job[]
  view: Presentation
  raised: boolean
}

const GenerationPanel = ({ job, jobs, view, raised }: GenerationPanelProps) => {
  const { status } = job
  const active = isActive(job)
  const percent = Math.floor(view.overall * 100)
  const queueLabel = queueLabelOf(job)
  const minimize = () => {
    setGenerationExpanded(false)
  }
  const dismiss = () => {
    dismissGeneration(job.id)
  }
  let hint = 'Keep browsing. This carries on in the corner.'
  if (status.kind === 'complete') {
    hint = 'Finishing up…'
  } else if (queueLabel !== null) {
    hint = 'Songs take turns on the server. Add more any time.'
  }

  return (
    <motion.section
      {...PANEL_MOTION}
      aria-label='Lyrics generation'
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (active) {
            minimize()
          } else {
            dismiss()
          }
        }
      }}
      className={cn(
        surfacePlacement(raised),
        // Centred on a touch screen, like every other panel there
        'touch:inset-x-0 touch:top-1/2 touch:bottom-auto touch:mx-auto touch:max-h-[calc(100dvh-var(--topbar-h)-2rem)] touch:-translate-y-1/2 touch:[--panel-origin:center]',
        'fixed z-50 max-h-[calc(100dvh-var(--topbar-h)-var(--stage-controls-h,0px)-2rem)] w-[min(400px,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto rounded-[20px] border border-white/10 bg-[#1b0812]/90 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.7)] backdrop-blur-xl'
      )}>
      <div className='flex flex-col gap-4 p-4'>
        <SongHeader job={job} onClose={active ? minimize : dismiss} />

        {jobs.length > 1 && <SongQueue jobs={jobs} focusedId={job.id} />}

        <AnimatePresence mode='wait' initial={false}>
          {view.revealed ? (
            <DoneView job={job} />
          ) : (
            <motion.div
              key='progress'
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className='flex flex-col gap-2'>
              <div
                role='progressbar'
                aria-label='Overall progress'
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className='flex items-end justify-between px-1'>
                <span className='text-5xl leading-none font-light tracking-tight text-white tabular-nums'>
                  {percent}
                  <span className='ml-0.5 text-xl text-white/50'>%</span>
                </span>
                <span className='pb-1 text-xs text-white/55'>
                  {status.kind === 'failed'
                    ? 'Stopped'
                    : view.complete
                      ? 'Done'
                      : (queueLabel ?? timeLeft(view.remainingS))}
                </span>
              </div>
              <StepWheel
                views={view.views}
                index={view.index}
                failed={status.kind === 'failed'}
              />
              {status.kind === 'failed' ? (
                <div className='flex flex-col gap-3'>
                  <p
                    role='alert'
                    className='rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200'>
                    {status.message}
                  </p>
                  <div className='flex gap-2'>
                    <Button
                      className='flex-1 gap-2'
                      onClick={() => {
                        retryGeneration(job.id)
                      }}>
                      <RotateCcw className='size-4' />
                      Try Again
                    </Button>
                    <Button
                      variant='ghost'
                      className='flex-1 text-white/80 hover:bg-white/10'
                      onClick={dismiss}>
                      Close
                    </Button>
                  </div>
                </div>
              ) : (
                <div className='flex h-9 items-center justify-between gap-3 px-1'>
                  <p className='text-xs text-white/45'>{hint}</p>
                  {active && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='shrink-0 text-white/60 hover:bg-white/10 hover:text-white'
                      onClick={() => {
                        cancelGeneration(job.id)
                      }}>
                      Cancel
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  )
}

export default GenerationPanel
