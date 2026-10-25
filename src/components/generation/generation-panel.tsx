import { Check, Play, RotateCcw, X } from 'lucide-react'
import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useDragControls,
  useReducedMotion,
} from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { startFromButton } from '@/components/generation/start-generation'
import { AdminMark } from '@/components/shared/admin-mark'
import { GoogleMark } from '@/components/shared/google-mark'
import { MarqueeText } from '@/components/shared/marquee-text'
import { Button } from '@/components/ui/button'
import { SIGN_IN_CODES, signInWithGoogle, useAccess } from '@/lib/auth'
import { overallValue } from '@/lib/generation/progress'
import type { Job } from '@/lib/generation/store'
import {
  dismissFinishedGenerations,
  dismissGeneration,
  fixKey,
  focusGeneration,
  isActive,
  retryGeneration,
  setGenerationExpanded,
  useGeneration,
} from '@/lib/generation/store'
import { useGetSongInfoBySongId } from '@/lib/react-query/queries-and-mutations'
import type { Fix } from '@/lib/report-fixes'
import { formatStamp } from '@/utils'
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
import type { Presentation } from './use-presentation'

// What a song shows until the backend sends its details, when nothing named it before
const PENDING_TITLE = 'Fetching Song Details…'

const timeLeft = (seconds: number) => {
  if (seconds < 20) {
    return 'Almost There'
  }
  if (seconds < 60) {
    return 'Under a Minute Left'
  }
  const minutes = Math.round(seconds / 60)
  return `About ${minutes} Min Left`
}

const generatingLabel = (job: Job, running: boolean) => {
  if (!running) {
    return ''
  }
  return job.mode === 'regenerate' ? 'Regenerating Lyrics' : 'Generating Lyrics'
}

// When a song finished, or null while it is still going
const finishedAt = ({ status }: Job) =>
  status.kind === 'complete' || status.kind === 'failed' ? status.at : null

// A notification's time, under or beside its name
const Stamp = ({ at, className }: { at: number; className?: string }) => (
  <time
    dateTime={new Date(at).toISOString()}
    className={cn('text-xs text-muted-foreground tabular-nums', className)}>
    {formatStamp(at)}
  </time>
)

// Marks what was unread when the panel opened, at the row's left; read out as "Unread" before its name
const UnreadDot = ({ className }: { className: string }) => (
  <span
    aria-hidden
    className={cn('absolute size-1.5 rounded-full bg-brand-light', className)}
  />
)
const UNREAD_LABEL = <span className='sr-only'>Unread: </span>

// Whether the open panel found this row unread (GenerationState.unread)
const useUnread = (key: string) => useGeneration().unread.includes(key)

const SongHeader = ({ job }: { job: Job }) => {
  const running = isActive(job)
  let title = titleOf(job)
  if (title === '') {
    title = running ? PENDING_TITLE : 'Song Details Unavailable'
  }
  const channel = job.video?.channel ?? ''
  const subtitle = channel === '' ? generatingLabel(job, running) : channel
  const at = finishedAt(job)
  const unread = useUnread(job.id)
  return (
    <div className='relative flex items-center gap-3'>
      {unread && <UnreadDot className='top-1/2 -left-3 -translate-y-1/2' />}
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
        <p className='truncate text-label font-semibold text-white'>
          {unread && UNREAD_LABEL}
          {title}
        </p>
        {(subtitle !== '' || at !== null) && (
          <p className='truncate text-sm text-muted-foreground'>
            {subtitle}
            {subtitle !== '' && at !== null && ' · '}
            {at !== null && <Stamp at={at} className='text-sm' />}
          </p>
        )}
      </div>
      {/* A failed song says Dismiss beside Try Again instead */}
      {job.status.kind === 'complete' && (
        <Button
          variant='overlay-icon'
          size='icon'
          className='size-8 shrink-0 touch:size-10'
          aria-label={`Dismiss ${title}`}
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

// A song's own action at the end of its row: Play once it is ready, Dismiss once it failed. Play is a slim pill in
// the row's height; on touch its press target reaches 44 px tall, still inside the row
const RowAction = ({ job, title }: { job: Job; title: string }) => {
  const outcome = outcomeOf(job)
  const name = title === '' ? 'this song' : title
  if (outcome) {
    return (
      <Button
        asChild
        size='row'
        className='relative shrink-0 touch:after:absolute touch:after:inset-x-0 touch:after:-inset-y-2'>
        <Link
          to={outcome.play.to}
          aria-label={`Play ${name}`}
          onClick={() => {
            dismissGeneration(job.id)
          }}>
          <Play className='size-3 fill-current' aria-hidden />
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

// Clears every finished song and every fix at once; songs still going stay, and the panel closes when none are
// left. Shown only once there are two to clear
const DismissAll = ({
  jobs,
  fixes,
  onDismissFixes,
}: {
  jobs: readonly Job[]
  fixes: readonly Fix[]
  onDismissFixes: (fixes: readonly Fix[]) => void
}) => {
  if (jobs.filter((job) => !isActive(job)).length + fixes.length < 2) {
    return null
  }
  return (
    <div className='-mt-2 -mr-0.5 -mb-3 flex justify-end'>
      <Button
        variant='overlay-muted'
        size='sm'
        onClick={() => {
          onDismissFixes(fixes)
          dismissFinishedGenerations()
        }}>
        Dismiss All
      </Button>
    </div>
  )
}

// A finished row let go past half its width, or flicked left this fast (px/s) past the X, is dismissed. A slower or
// shorter swipe past half the X leaves the row open on it (owner, 2026-10-25: a full swipe can't be the only way)
const DISMISS_SHARE = 0.5
const FLICK_SPEED = 600
// How far an open row stands aside: the X's 44px target and a gap either side
const REVEAL_PX = 60

// A row of the panel's list. A finished one is dismissed on touch by a swipe left, or by the X a shorter swipe
// leaves showing; a tap anywhere else, or a swipe right, closes it again. A mouse finds an X on hover (and the
// keyboard on focus); the rows below close the gap
const SwipeRow = ({
  name,
  unread,
  finished,
  hoverDismiss,
  onDismiss: dismiss,
  picked = false,
  main,
  action,
}: {
  name: string
  // Unread when the panel opened: a dot left of the thumbnail
  unread: boolean
  // Swipes away on touch
  finished: boolean
  // A failed song has its X in view already
  hoverDismiss: boolean
  onDismiss: () => void
  picked?: boolean
  // The row's own press: a button or a link filling the row
  main: ReactNode
  action: ReactNode
}) => {
  const reduced = useReducedMotion() ?? false
  const drag = useDragControls()
  const slide = useAnimationControls()
  const row = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // A swipe ends with the finger lifted over a button, and a tap on an open row only closes it: neither presses
  const swallowClick = useRef(false)
  const close = () => {
    setOpen(false)
    void slide.start({
      transition: { bounce: 0, duration: 0.25, type: 'spring' },
      x: 0,
    })
  }
  const slideOut = async () => {
    await slide.start({
      transition: { duration: 0.15, ease: 'easeOut' },
      x: -(row.current?.offsetWidth ?? 0),
    })
    dismiss()
  }
  const settle = (offset: number, velocity: number) => {
    const width = row.current?.offsetWidth ?? 0
    const at = (open ? -REVEAL_PX : 0) + offset
    if (
      at < -width * DISMISS_SHARE ||
      (velocity < -FLICK_SPEED && at < -REVEAL_PX)
    ) {
      void slideOut()
    } else if (at < -REVEAL_PX / 2 && velocity < FLICK_SPEED / 2) {
      setOpen(true)
      void slide.start({
        transition: { bounce: 0, duration: 0.25, type: 'spring' },
        x: -REVEAL_PX,
      })
    } else {
      close()
    }
  }
  // Open, a press anywhere but this row (it closes on its own click) and its X closes it, so one row is open at most
  const closeRef = useRef(close)
  closeRef.current = close
  const reveal = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) {
      return
    }
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !(row.current?.contains(target) ?? false) &&
        !(reveal.current?.contains(target) ?? false)
      ) {
        closeRef.current()
      }
    }
    document.addEventListener('pointerdown', onPress, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPress, { capture: true })
    }
  }, [open])
  return (
    <motion.li
      data-marquee-host
      exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className='relative overflow-hidden rounded-lg'>
      {/* Under the row, which covers it until it moves aside; pressable once a swipe leaves it showing */}
      {finished && (
        <button
          ref={reveal}
          type='button'
          tabIndex={-1}
          aria-hidden={!open}
          aria-label={`Dismiss ${name}`}
          onClick={() => {
            void slideOut()
          }}
          className={cn(
            'absolute inset-y-0 right-0 flex w-15 items-center justify-center text-muted-foreground outline-none',
            !open && 'pointer-events-none'
          )}>
          <span className='flex size-9 items-center justify-center rounded-full bg-secondary text-white/80'>
            <X className='size-4' aria-hidden />
          </span>
        </button>
      )}
      <motion.div
        ref={row}
        drag={finished ? 'x' : false}
        dragListener={false}
        dragControls={drag}
        dragDirectionLock
        dragMomentum={false}
        dragConstraints={{ right: 0 }}
        dragElastic={0.2}
        animate={slide}
        onPointerDown={(event) => {
          swallowClick.current = open
          if (finished && event.pointerType !== 'mouse') {
            drag.start(event)
          }
        }}
        onDragStart={() => {
          swallowClick.current = true
        }}
        onDragEnd={(_, info) => {
          settle(info.offset.x, info.velocity.x)
        }}
        onClickCapture={(event) => {
          if (swallowClick.current) {
            event.preventDefault()
            event.stopPropagation()
            swallowClick.current = false
            if (open) {
              close()
            }
          }
        }}
        className={cn(
          'group relative flex items-center gap-1 rounded-lg bg-popover pr-3 pl-1.5 hover:bg-accent',
          finished && 'touch-pan-y',
          picked && 'bg-accent'
        )}>
        {unread && <UnreadDot className='top-1/2 left-0.5 -translate-y-1/2' />}
        <div className='relative flex min-w-0 flex-1 self-stretch'>
          {main}
          {/* Over the end of the title, not in the row's flow: it comes in from the right without moving anything */}
          {hoverDismiss && (
            <button
              type='button'
              aria-label={`Dismiss ${name}`}
              onClick={dismiss}
              className='pointer-events-none absolute top-1/2 right-1 flex size-7 translate-x-2 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-white/80 opacity-0 transition-fade-translate duration-150 ease-out outline-none group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-light motion-reduce:translate-x-0'>
              <X className='size-4' aria-hidden />
            </button>
          )}
        </div>
        {action}
      </motion.div>
    </motion.li>
  )
}

const ROW_MAIN =
  'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-light touch:py-2'

const RowThumbnail = ({ src }: { src: string }) => (
  <span className='h-8 w-[57px] shrink-0 overflow-hidden rounded bg-thumbnail-placeholder'>
    <img
      src={src}
      alt=''
      onError={hideBrokenImage}
      onLoad={hidePlaceholderImage}
      className='size-full object-cover'
    />
  </span>
)

// One song in the queue. Picked, its details open right under it and say how it is going, so it shows no status;
// `actionBelow`: they carry its Play or Dismiss as well (a failed song's, or a finished one's once revealed)
const SongRow = ({
  job,
  picked,
  actionBelow = false,
}: {
  job: Job
  picked: boolean
  actionBelow?: boolean
}) => {
  const title = titleOf(job)
  const status = picked ? null : rowStatus(job)
  const name = title === '' ? 'this song' : title
  const at = finishedAt(job)
  const unread = useUnread(job.id)
  return (
    <SwipeRow
      name={name}
      unread={unread}
      finished={!isActive(job)}
      hoverDismiss={job.status.kind === 'complete'}
      onDismiss={() => {
        dismissGeneration(job.id)
      }}
      picked={picked}
      action={actionBelow ? null : <RowAction job={job} title={title} />}
      main={
        <button
          type='button'
          aria-current={picked}
          onClick={() => {
            focusGeneration(job.id)
          }}
          className={ROW_MAIN}>
          <RowThumbnail src={thumbnailOf(job)} />
          <span className='flex min-w-0 flex-1 flex-col'>
            {unread && UNREAD_LABEL}
            <MarqueeText
              className={cn(
                'min-w-0 text-sm',
                title === '' ? 'text-faint' : 'text-foreground'
              )}>
              {title === '' ? PENDING_TITLE : title}
            </MarqueeText>
            {at !== null && <Stamp at={at} />}
          </span>
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
      }
    />
  )
}

// A song the listener reported whose lyrics were fixed since. Opening it, from the row or its Play, counts as done
// with it, as Play does for a finished song: it leaves the list on every device
const FixRow = ({
  fix,
  onDismiss,
}: {
  fix: Fix
  onDismiss: (fixes: readonly Fix[]) => void
}) => {
  const { data: song, isError } = useGetSongInfoBySongId(fix.videoId)
  const title = song?.title ?? ''
  const name = title === '' ? 'this song' : title
  const to = `/v/${fix.videoId}`
  const dismiss = () => {
    onDismiss([fix])
  }
  let shownTitle = title
  if (title === '') {
    shownTitle = isError ? 'Song Details Unavailable' : PENDING_TITLE
  }
  const unread = useUnread(fixKey(fix.videoId))
  return (
    <SwipeRow
      name={name}
      unread={unread}
      finished
      hoverDismiss
      onDismiss={dismiss}
      main={
        <Link to={to} onClick={dismiss} className={ROW_MAIN}>
          <RowThumbnail
            src={`https://i.ytimg.com/vi/${fix.videoId}/mqdefault.jpg`}
          />
          <span className='flex min-w-0 flex-1 flex-col'>
            {unread && UNREAD_LABEL}
            <MarqueeText
              className={cn(
                'min-w-0 text-sm',
                title === '' ? 'text-faint' : 'text-foreground'
              )}>
              {shownTitle}
            </MarqueeText>
            <Stamp at={fix.fixedAt} />
          </span>
        </Link>
      }
      action={
        <Button
          asChild
          size='row'
          className='relative shrink-0 touch:after:absolute touch:after:inset-x-0 touch:after:-inset-y-2'>
          <Link to={to} aria-label={`Play ${name}`} onClick={dismiss}>
            <Play className='size-3 fill-current' aria-hidden />
            Play
          </Link>
        </Button>
      }
    />
  )
}

// Under everything else, so a fix that arrives while the panel is open moves nothing the listener is looking at
const FixList = ({
  fixes,
  onDismiss,
}: {
  fixes: readonly Fix[]
  onDismiss: (fixes: readonly Fix[]) => void
}) => (
  <section aria-labelledby='fixes-heading' className='flex flex-col gap-1'>
    <h3
      id='fixes-heading'
      className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
      Lyrics Fixed
    </h3>
    <ul aria-label='Lyrics Fixed' className='-mx-3 flex flex-col gap-0.5'>
      <AnimatePresence initial={false}>
        {fixes.map((fix) => (
          <FixRow key={fix.videoId} fix={fix} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </ul>
  </section>
)

// Every song in the queue, shared by all tabs, oldest first; picking one opens its details under its row, which
// is their header: the song isn't drawn a second time. Not a list item of its own (role none), so the list still
// counts songs
const SongQueue = ({
  jobs,
  focusedId,
  detail,
  actionBelow,
}: {
  jobs: readonly Job[]
  focusedId: string
  detail: ReactNode
  actionBelow: boolean
}) => (
  <ul aria-label='Songs' className='-mx-3 flex flex-col gap-0.5'>
    <AnimatePresence initial={false}>
      {jobs.flatMap((job) => {
        const picked = job.id === focusedId
        const row = (
          <SongRow
            key={job.id}
            job={job}
            picked={picked}
            actionBelow={picked && actionBelow}
          />
        )
        return picked
          ? [
              row,
              <li
                key={`${job.id}:detail`}
                role='none'
                className='flex flex-col gap-4 px-3 pt-2 pb-6'>
                {detail}
              </li>,
            ]
          : [row]
      })}
    </AnimatePresence>
  </ul>
)

// The picked song's progress and steps; `header`: the song's own header above them, when no list row stands for it
const SongDetail = ({
  job,
  view,
  header,
}: {
  job: Job
  view: Presentation
  header: boolean
}) => {
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
    <>
      {header && <SongHeader job={job} />}

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
              aria-label='Overall Progress'
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
                {/* Announced once, by GenerationHost's polite line */}
                <p className='rounded-lg bg-error-strong/10 px-3 py-2 text-sm text-error-soft'>
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
                      <GoogleMark />
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
                    className='touch:h-11'
                    onClick={() => {
                      // As a tap outside: the panel closes, the song goes on in the top bar's ring
                      setGenerationExpanded(false)
                    }}>
                    Hide
                  </Button>
                </div>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

interface GenerationPanelProps {
  // The song whose steps show under the list; null when only fixes are listed
  job: Job | null
  jobs: readonly Job[]
  fixes: readonly Fix[]
  onDismissFixes: (fixes: readonly Fix[]) => void
}

// The top bar panel's body: every song in the queue with the picked one's steps under its row (one song: its
// header and steps), then the reported songs fixed
const GenerationPanel = ({
  job,
  jobs,
  fixes,
  onDismissFixes,
}: GenerationPanelProps) => {
  const view = usePresentation(job)
  const listed = job !== null && jobs.length > 1
  const detail =
    job !== null && view !== null ? (
      <SongDetail job={job} view={view} header={!listed} />
    ) : null
  return (
    <div className='flex flex-col gap-4 p-4'>
      <DismissAll jobs={jobs} fixes={fixes} onDismissFixes={onDismissFixes} />
      {listed ? (
        <SongQueue
          jobs={jobs}
          focusedId={job.id}
          detail={detail}
          actionBelow={
            job.status.kind === 'failed' ||
            (view?.revealed === true && outcomeOf(job) !== null)
          }
        />
      ) : (
        detail
      )}
      {fixes.length > 0 && <FixList fixes={fixes} onDismiss={onDismissFixes} />}
    </div>
  )
}

export default GenerationPanel
