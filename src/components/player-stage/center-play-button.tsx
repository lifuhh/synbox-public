import {
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { useArmed } from '@/hooks/use-armed'
import { cn } from '@/utils/cn'

import type { StagePhase } from './use-you-tube-player'

// YouTube's player draws its own play/pause button (a 56px see-through disc) in the middle of the video for
// about 4s each time playback starts, resumes or seeks, controls=0 or not. Phones got it first; since
// 2026-10-24 desktop Chrome does too. A pause inside those 4s keeps it up for the whole pause
const YOUTUBE_CENTER_MS = 4500

// True from each PLAYING report until YOUTUBE_CENTER_MS after it, and through a pause that began before then.
// A new phase object comes with every PLAYING report, so a seek that resumes starts the time again
export const useYouTubeCenterShowing = (phase: StagePhase) => {
  const [playingSince, setPlayingSince] = useState<StagePhase | null>(null)
  if (phase.kind === 'playing' && playingSince !== phase) {
    setPlayingSince(phase)
  }
  const [expired, setExpired] = useState<StagePhase | null>(null)
  const paused = phase.kind === 'paused'
  // Paused, no timer runs, so the window stays open until the next PLAYING report opens a new one
  useEffect(() => {
    const timer = paused
      ? undefined
      : setTimeout(() => {
          setExpired(playingSince)
        }, YOUTUBE_CENTER_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [playingSince, paused])
  return (
    playingSince !== null &&
    expired !== playingSince &&
    (phase.kind === 'playing' || phase.kind === 'buffering' || paused)
  )
}

// Where the middle row stands: the video's centre, over YouTube's own button. A narrow watch page's small video
// (180px tall at 320px wide) has the control bar's rows over its bottom 82px, and the centre put the row on them
// (A114: Play's lower 24px under the rows at 320px, so a press there missed). There it rises just enough to clear
// them by the bar's gap (--stage-controls-h: the rows' height plus that gap, published by the bar)
const TRANSPORT_TOP =
  'top-(--video-cy) watch-narrow:top-[min(var(--video-cy),calc(100cqh-var(--stage-controls-h,5rem)-2rem))]'

// Where Previous and Next beside the middle button show. On the watch page: where a finger plays or the video is
// small (a narrow watch page, whose control bar leaves them out), but not on a phone on its side, whose bar row is
// enough. Full screen: with a finger, on its side too (the bar leaves them to this row there)
const WATCH_STEPS = 'hidden watch-narrow:grid touch:grid short:hidden'
const FULL_SCREEN_STEPS = 'hidden touch:grid'

// A button beside the middle play button, a size down, with the floating UI
const StepButton = ({
  label,
  side,
  shows,
  visible,
  onClick,
  children,
}: {
  label: string
  side: 'start' | 'end'
  shows: string
  visible: boolean
  onClick: (() => void) | undefined
  children: ReactNode
}) => {
  const armed = useArmed(visible)
  return (
    <button
      type='button'
      tabIndex={-1}
      aria-label={label}
      aria-hidden={!visible}
      disabled={onClick === undefined}
      onClick={onClick}
      className={cn(
        'absolute z-26 size-12 -translate-1/2 place-items-center rounded-full bg-black/60 text-white shadow-stage backdrop-blur-md transition-opacity duration-300 disabled:text-white/35',
        shows,
        TRANSPORT_TOP,
        side === 'start' ? 'left-[calc(50%-5rem)]' : 'left-[calc(50%+5rem)]',
        visible ? 'opacity-100' : 'opacity-0',
        !armed && 'pointer-events-none'
      )}>
      {children}
    </button>
  )
}

// The play/pause control in the middle of the video, between Previous and Next, where a finger plays or the video
// is small (a narrow watch page). Its disc is dark enough to hide YouTube's own button under it, which sits on the
// same spot and is 56px wide, so it stays while YouTube's shows even when the rest of the floating UI has gone (a
// tap hiding it, a lock or a drag). Alone it only covers: it takes presses only with the rest of the UI, so a tap on
// it then shows the controls instead of pausing. A mouse on a wide page gets no disc of ours: the bar has play,
// a press flashes what it did (play-flash.tsx), and YouTube's own button shows for its ~4.5s after a play
// (2026-10-26: it can't be turned off, and a cover is only another disc). A narrow watch page's row may stand above
// the video's centre (TRANSPORT_TOP), off YouTube's button, so there it shows only with the controls
export const CenterPlayButton = ({
  phase,
  controlsVisible,
  youTubeCenterShowing,
  fullScreen,
  onToggle,
  onPrevious,
  onNext,
}: {
  phase: StagePhase
  controlsVisible: boolean
  youTubeCenterShowing: boolean
  fullScreen: boolean
  onToggle: () => void
  onPrevious: () => void
  onNext: (() => void) | undefined
}) => {
  const visible = controlsVisible || youTubeCenterShowing
  // The watch page on a phone on its side (the `short:` variant, a Lock Landscape page included) has the lyrics
  // across the middle of the screen: there the bar's own play button is enough, and this one shows only while it
  // covers YouTube's. Full screen it shows with the controls, Previous and Next beside it as on YouTube's phone
  // player (owner, 2026-10-27; the bar keeps -10s and +10s); the lyrics fade back while they show
  // (`lyrics-behind-controls` in globals.css)
  const onlyForControls = !youTubeCenterShowing && !fullScreen
  const armed = useArmed(controlsVisible)
  return (
    <>
      <StepButton
        label='Previous'
        side='start'
        shows={fullScreen ? FULL_SCREEN_STEPS : WATCH_STEPS}
        visible={controlsVisible}
        onClick={onPrevious}>
        <SkipBackIcon className='size-6 fill-current' />
      </StepButton>
      <StepButton
        label='Next'
        side='end'
        shows={fullScreen ? FULL_SCREEN_STEPS : WATCH_STEPS}
        visible={controlsVisible}
        onClick={onNext}>
        <SkipForwardIcon className='size-6 fill-current' />
      </StepButton>
      <button
        type='button'
        tabIndex={-1}
        aria-label={phase.kind === 'playing' ? 'Pause' : 'Play'}
        aria-hidden={!visible}
        data-controls={controlsVisible}
        data-full-screen-controls={
          fullScreen && controlsVisible ? '' : undefined
        }
        onClick={onToggle}
        className={cn(
          'absolute left-1/2 z-26 grid size-16 -translate-1/2 place-items-center rounded-full bg-black/60 text-white shadow-stage backdrop-blur-md transition-opacity duration-300 watch-narrow:data-[controls=false]:opacity-0 mouse:hidden mouse:watch-narrow:grid',
          TRANSPORT_TOP,
          visible ? 'opacity-100' : 'opacity-0',
          !armed && 'pointer-events-none',
          onlyForControls && 'short:pointer-events-none short:opacity-0'
        )}>
        {phase.kind === 'paused' ? (
          <PlayIcon className='size-8 translate-x-0.5 fill-current' />
        ) : (
          <PauseIcon className='size-8 fill-current' />
        )}
      </button>
    </>
  )
}
