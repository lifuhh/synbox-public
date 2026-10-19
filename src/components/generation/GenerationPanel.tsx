import { Check, Minus, Play, RotateCcw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import type { Job } from '@/lib/generation/store'
import {
  cancelGeneration,
  dismissGeneration,
  retryGeneration,
  setGenerationExpanded,
  startGeneration,
} from '@/lib/generation/store'
import { cn } from '@/utils/cn'

import StepWheel from './StepWheel'
import {
  hideBrokenImage,
  hidePlaceholderImage,
  SURFACE_LAYOUT_ID,
  outcomeCopy,
  SURFACE_SPRING,
  surfacePlacement,
  thumbnailOf,
  titleOf,
} from './surface'
import type { Presentation } from './usePresentation'

const timeLeft = (seconds: number, slow: boolean) => {
  if (slow) {
    return 'Taking longer than usual'
  }
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
  const running = job.status.kind === 'running'
  const title = titleOf(job)
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
        <p className='truncate text-xs text-white/55'>
          {job.mode === 'regenerate' ? 'New Lyrics Version' : 'New Lyrics'}
          {job.video !== null && job.video.channel !== ''
            ? ` · ${job.video.channel}`
            : ''}
        </p>
      </div>
      <Button
        variant='ghost'
        size='icon'
        className='size-8 shrink-0 rounded-full text-white/70 hover:bg-white/10 hover:text-white'
        aria-label={running ? 'Minimize' : 'Close'}
        onClick={onClose}>
        {running ? <Minus className='size-4' /> : <X className='size-4' />}
      </Button>
    </div>
  )
}

const DoneView = ({ job }: { job: Job }) => {
  if (job.status.kind !== 'complete') {
    return null
  }
  const { outcome } = job.status
  const copy = outcomeCopy(job)
  const close = () => {
    dismissGeneration()
  }
  return (
    <motion.div
      key='done'
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className='flex flex-col items-center gap-4 py-4 text-center'>
      <motion.span
        initial={{ scale: 0.4, rotate: -20 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ damping: 12, stiffness: 260, type: 'spring' }}
        className='flex size-14 items-center justify-center rounded-full bg-linear-to-br from-[#f785b3] to-primary text-white shadow-[0_0_32px_-6px_#eb6fce]'>
        <Check className='size-7' strokeWidth={3} aria-hidden />
      </motion.span>
      <div className='space-y-1'>
        <p className='text-lg font-semibold text-white'>{copy?.title}</p>
        <p className='text-sm text-white/60'>{copy?.detail}</p>
      </div>
      <div className='flex w-full flex-col gap-2'>
        {outcome.kind === 'version' ? (
          <>
            <Button asChild className='w-full gap-2'>
              {/* A version that is already the default plays as the song itself */}
              <Link
                to={
                  outcome.active
                    ? `/v/${job.videoId}`
                    : `/v/${job.videoId}?version=${outcome.version}`
                }
                onClick={close}>
                <Play className='size-4 fill-current' />
                {outcome.active
                  ? 'Play Now'
                  : `Preview Version ${outcome.version}`}
              </Link>
            </Button>
            <Button
              asChild
              variant='ghost'
              className='w-full text-white/80 hover:bg-white/10'>
              <Link to={`/v/${job.videoId}/versions`} onClick={close}>
                Compare Versions
              </Link>
            </Button>
          </>
        ) : (
          <Button asChild className='w-full gap-2'>
            <Link to={`/v/${job.videoId}`} onClick={close}>
              <Play className='size-4 fill-current' />
              Play Now
            </Link>
          </Button>
        )}
      </div>
      {!job.forceAi && (
        <button
          type='button'
          className='text-xs text-white/50 underline-offset-4 hover:text-white/80 hover:underline'
          onClick={() => {
            startGeneration({
              forceAi: true,
              mode: 'regenerate',
              title: titleOf(job),
              videoId: job.videoId,
            })
          }}>
          Lyrics look wrong? Regenerate from the audio only
        </button>
      )}
    </motion.div>
  )
}

interface GenerationPanelProps {
  job: Job
  view: Presentation
  raised: boolean
}

const GenerationPanel = ({ job, view, raised }: GenerationPanelProps) => {
  const { status } = job
  const percent = Math.floor(view.overall * 100)
  const slow = view.views[view.index]?.slow ?? false
  const minimize = () => {
    setGenerationExpanded(false)
  }

  return (
    <motion.section
      layoutId={SURFACE_LAYOUT_ID}
      transition={SURFACE_SPRING}
      style={{ borderRadius: 20 }}
      aria-label='Lyrics generation'
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (status.kind === 'running') minimize()
          else dismissGeneration()
        }
      }}
      className={cn(
        surfacePlacement(raised),
        'fixed z-50 w-[min(400px,calc(100vw-2rem))] overflow-hidden border border-white/10 bg-[#1b0812]/90 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.7)] backdrop-blur-xl'
      )}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.12, duration: 0.2 }}
        className='flex flex-col gap-4 p-4'>
        <SongHeader
          job={job}
          onClose={status.kind === 'running' ? minimize : dismissGeneration}
        />

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
                      : timeLeft(view.remainingS, slow)}
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
                    <Button className='flex-1 gap-2' onClick={retryGeneration}>
                      <RotateCcw className='size-4' />
                      Try Again
                    </Button>
                    <Button
                      variant='ghost'
                      className='flex-1 text-white/80 hover:bg-white/10'
                      onClick={dismissGeneration}>
                      Close
                    </Button>
                  </div>
                </div>
              ) : (
                <div className='flex h-9 items-center justify-between gap-3 px-1'>
                  <p className='text-xs text-white/45'>
                    {status.kind === 'complete'
                      ? 'Finishing up…'
                      : 'Keep browsing. This carries on in the corner.'}
                  </p>
                  {status.kind === 'running' && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='shrink-0 text-white/60 hover:bg-white/10 hover:text-white'
                      onClick={cancelGeneration}>
                      Cancel
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.section>
  )
}

export default GenerationPanel
