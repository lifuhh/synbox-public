import { Check, LogIn, Play, RotateCcw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'react-router'

import { startFromButton } from '@/components/generation/start-generation'
import { AdminMark } from '@/components/shared/admin-mark'
import { KaraokeBadge, KaraokeMark } from '@/components/shared/karaoke-badge'
import { MarqueeText } from '@/components/shared/marquee-text'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { SIGN_IN_CODES, signInWithGoogle, useAccess } from '@/lib/auth'
import { overallValue } from '@/lib/generation/progress'
import type { Job, JobStatus } from '@/lib/generation/store'
import {
  cancelGeneration,
  dismissFinishedGenerations,
  dismissGeneration,
  focusGeneration,
  isActive,
  retryGeneration,
} from '@/lib/generation/store'
import { cn } from '@/utils/cn'

import StepWheel from './step-wheel'
import {
  hideBrokenImage,
  hidePlaceholderImage,
  outcomeOf,
  queueLabelOf,
  thumbnailOf,
  titleOf,
} from './surface'
import { isReconnecting, usePresentation } from './use-presentation'

// What a song shows until the backend sends its details, when nothing named it before
const PENDING_TITLE = 'Fetching Song Details…'

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

const generatingLabel = (job: Job, running: boolean) => {
  if (!running) {
    return ''
  }
  return job.mode === 'regenerate' ? 'Regenerating Lyrics' : 'Generating Lyrics'
}

const SongHeader = ({ job }: { job: Job }) => {
  const running = isActive(job)
  let title = titleOf(job)
  if (title === '') {
    title = running ? PENDING_TITLE : 'Song Details Unavailable'
  }
  const channel = job.video?.channel ?? ''
  const subtitle = channel === '' ? generatingLabel(job, running) : channel
  return (
    <div className='flex items-center gap-3'>
      <span className='h-10 w-[71px] shrink-0 overflow-hidden rounded-md bg-thumbnail-placeholder'>
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
        <p className='truncate text-label font-semibold text-white'>{title}</p>
        {subtitle !== '' && (
          <p className='truncate text-sm text-muted-foreground'>{subtitle}</p>
        )}
      </div>
      {/* A failed song says Dismiss beside Try Again instead */}
      {job.status.kind === 'complete' && (
        <Button
          variant='overlay-icon'
          size='icon'
          className='size-8 shrink-0 touch:size-10'
          aria-label='Dismiss'
          onClick={() => {
            dismissGeneration(job.id)
          }}>
          <X className='size-4' />
        </Button>
      )}
    </div>
  )
}

const DoneView = ({ job }: { job: Job }) => {
  const { admin } = useAccess()
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
        className='flex size-12 items-center justify-center rounded-full bg-primary-subtle text-primary-text'>
        <Check className='size-6' strokeWidth={3} aria-hidden />
      </motion.span>
      <p className='px-2 text-label font-semibold text-white'>
        {outcome.title}
      </p>
      <Button asChild gap='md' className='w-full'>
        <Link to={outcome.play.to} onClick={close}>
          <Play className='size-4 fill-current' />
          {outcome.play.label}
        </Link>
      </Button>
      {admin && (outcome.versions || !job.skipUploaderLyrics) && (
        <div className='flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-faint'>
          {admin && outcome.versions && (
            <Link
              to={`/v/${job.videoId}/versions`}
              onClick={close}
              className='inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline'>
              <AdminMark />
              See All Versions
            </Link>
          )}
          {admin && !job.skipUploaderLyrics && (
            <button
              type='button'
              className='inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline'
              onClick={() => {
                void startFromButton({
                  mode: 'regenerate',
                  skipUploaderLyrics: true,
                  title: titleOf(job),
                  videoId: job.videoId,
                })
              }}>
              <AdminMark />
              Lyrics look off? Try without the video&apos;s subtitles
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}

// A finished song's row carries its Play button instead of a status
const rowStatus = (job: Job) => {
  const { status } = job
  if (status.kind === 'failed') {
    return 'Failed'
  }
  if (status.kind === 'complete') {
    return null
  }
  const now = Date.now()
  if (isReconnecting(job, now)) {
    return 'Reconnecting…'
  }
  return (
    queueLabelOf(job) ??
    `${Math.floor(overallValue(job.runs, now, false) * 100)}%`
  )
}

// The run's timed lyrics are now the song's live lyrics. When it saved nothing new, the library list says
const madeKaraoke = (status: Extract<JobStatus, { kind: 'complete' }>) =>
  status.karaoke !== null &&
  (status.outcome.kind === 'created' ||
    (status.outcome.kind === 'version' && status.outcome.active))

// A song's own action at the end of its row: Play once it is ready, Dismiss once it failed
const RowAction = ({ job, title }: { job: Job; title: string }) => {
  const outcome = outcomeOf(job)
  const name = title === '' ? 'this song' : title
  if (outcome) {
    return (
      <Button asChild size='sm' gap='sm' className='h-8 shrink-0 touch:h-11'>
        <Link
          to={outcome.play.to}
          aria-label={`Play ${name}`}
          onClick={() => {
            dismissGeneration(job.id)
          }}>
          <Play className='size-3.5 fill-current' aria-hidden />
          Play
        </Link>
      </Button>
    )
  }
  if (job.status.kind === 'failed') {
    return (
      <Button
        variant='overlay-icon'
        size='icon'
        className='size-8 shrink-0 touch:size-11'
        aria-label={`Dismiss ${name}`}
        onClick={() => {
          dismissGeneration(job.id)
        }}>
        <X className='size-4' aria-hidden />
      </Button>
    )
  }
  return null
}

// Clears every finished song at once; songs still going stay, and the panel closes when none are left. Shown
// only once there are two to clear
const DismissAll = ({ jobs }: { jobs: readonly Job[] }) => {
  if (jobs.filter((job) => !isActive(job)).length < 2) {
    return null
  }
  return (
    <div className='-mt-2 -mr-0.5 -mb-3 flex justify-end'>
      <Button
        variant='overlay-muted'
        size='sm'
        onClick={dismissFinishedGenerations}>
        Dismiss All
      </Button>
    </div>
  )
}

// Every song in the queue, shared by all tabs, oldest first; picking one shows it in the panel
const SongQueue = ({
  jobs,
  focusedId,
}: {
  jobs: readonly Job[]
  focusedId: string
}) => (
  <ul aria-label='Songs' className='-mx-1.5 flex flex-col gap-0.5'>
    {jobs.map((job) => {
      const title = titleOf(job)
      const status = rowStatus(job)
      return (
        <li
          key={job.id}
          data-marquee-host
          className={cn(
            'flex items-center gap-1 rounded-lg pr-1 hover:bg-accent',
            job.id === focusedId && 'bg-accent'
          )}>
          <button
            type='button'
            aria-current={job.id === focusedId}
            onClick={() => {
              focusGeneration(job.id)
            }}
            className='flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-lg px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-light touch:py-2'>
            <span className='h-8 w-[57px] shrink-0 overflow-hidden rounded bg-thumbnail-placeholder'>
              <img
                src={thumbnailOf(job)}
                alt=''
                onError={hideBrokenImage}
                onLoad={hidePlaceholderImage}
                className='size-full object-cover'
              />
            </span>
            <MarqueeText
              className={cn(
                'min-w-0 flex-1 text-sm',
                title === '' ? 'text-faint' : 'text-foreground'
              )}>
              {title === '' ? PENDING_TITLE : title}
            </MarqueeText>
            {job.status.kind === 'complete' &&
              (madeKaraoke(job.status) ? (
                <KaraokeBadge />
              ) : (
                <KaraokeMark videoId={job.videoId} />
              ))}
            {status !== null && (
              <span
                className={cn(
                  'shrink-0 text-sm tabular-nums',
                  job.status.kind === 'failed'
                    ? 'text-error'
                    : 'text-muted-foreground'
                )}>
                {status}
              </span>
            )}
          </button>
          <RowAction job={job} title={title} />
        </li>
      )
    })}
  </ul>
)

interface GenerationPanelProps {
  // The song whose steps show under the list
  job: Job
  jobs: readonly Job[]
}

// The top bar panel's body: every song in the queue, and the steps of the one picked
const GenerationPanel = ({ job, jobs }: GenerationPanelProps) => {
  const view = usePresentation(job)
  if (!view) {
    return null
  }
  const { status } = job
  const active = isActive(job)
  const percent = Math.floor(view.overall * 100)
  const queueLabel = queueLabelOf(job)
  const dismiss = () => {
    dismissGeneration(job.id)
  }
  const progressNote = () => {
    if (status.kind === 'failed') {
      return 'Stopped'
    }
    if (view.complete) {
      return 'Done'
    }
    if (view.reconnecting) {
      return 'Reconnecting…'
    }
    return queueLabel ?? timeLeft(view.remainingS)
  }

  return (
    <div className='flex flex-col gap-4 p-4'>
      <DismissAll jobs={jobs} />
      {jobs.length > 1 && <SongQueue jobs={jobs} focusedId={job.id} />}

      <SongHeader job={job} />

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
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a styled bar with progressbar semantics; <progress> cannot be styled the same in every browser
              role='progressbar'
              aria-label='Overall progress'
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className='flex items-baseline justify-between'>
              <span className='text-2xl leading-tight font-semibold tracking-tight text-white tabular-nums'>
                {percent}
                <span className='text-muted-foreground'>%</span>
              </span>
              <span className='text-sm text-muted-foreground'>
                {progressNote()}
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
                  className='rounded-lg bg-error-strong/10 px-3 py-2 text-sm text-error-soft'>
                  {status.message}
                </p>
                <div className='flex gap-2'>
                  {status.code !== undefined &&
                  SIGN_IN_CODES.has(status.code) ? (
                    <Button
                      gap='md'
                      className='flex-1'
                      onClick={() => {
                        void signInWithGoogle()
                      }}>
                      <LogIn className='size-4' />
                      Sign In
                    </Button>
                  ) : null}
                  {status.retry ? (
                    <Button
                      gap='md'
                      className='flex-1'
                      onClick={() => {
                        retryGeneration(job.id)
                      }}>
                      <RotateCcw className='size-4' />
                      Try Again
                    </Button>
                  ) : null}
                  <Button
                    variant='overlay-outline'
                    className='flex-1'
                    onClick={dismiss}>
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : (
              active && (
                <div className='flex justify-end'>
                  <Button
                    variant='overlay-muted'
                    size='sm'
                    onClick={() => {
                      cancelGeneration(job.id)
                      // Nothing can stop the server's job once it runs: this only stops showing it
                      toast({
                        description:
                          'The server may still finish it and add it to the library.',
                        title: 'Stopped Watching This Song',
                      })
                    }}>
                    Stop Watching
                  </Button>
                </div>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default GenerationPanel
