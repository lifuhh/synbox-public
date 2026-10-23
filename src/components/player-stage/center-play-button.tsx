import {
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { useArmed } from '@/hooks/use-armed'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/utils/cn'

import type { StagePhase } from './use-you-tube-player'

// YouTube's phone player draws its own play/pause button (a 56px see-through disc) in the middle of the video
// for about 4s each time playback starts or resumes after a seek, controls=0 or not. Ours covers it that long
const YOUTUBE_CENTER_MS = 4500

// True from each time the player reports playing until YOUTUBE_CENTER_MS after it. A new phase object
// comes with every PLAYING report, so a seek that resumes starts the time again
const useYouTubeCenterShowing = (phase: StagePhase) => {
  const phone = useMediaQuery('(pointer: coarse)')
  const [playingSince, setPlayingSince] = useState<StagePhase | null>(null)
  if (phase.kind === 'playing' && playingSince !== phase) {
    setPlayingSince(phase)
  }
  const [expired, setExpired] = useState<StagePhase | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      setExpired(playingSince)
    }, YOUTUBE_CENTER_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [playingSince])
  return phone && phase.kind === 'playing' && expired !== playingSince
}

// Previous or Next beside the middle play button, a size down, with the floating UI. Only where a finger plays
// or the video is small (a narrow watch page, whose control bar leaves them out): elsewhere the control bar has
// them, and on a phone on its side its row is enough
const StepButton = ({
  label,
  side,
  visible,
  onClick,
  children,
}: {
  label: string
  side: 'start' | 'end'
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
        'hidden absolute top-(--video-cy) z-26 size-12 -translate-1/2 place-items-center rounded-full bg-black/60 text-white shadow-stage backdrop-blur-md transition-opacity duration-300 disabled:text-white/35 watch-narrow:grid touch:grid short:hidden',
        side === 'start' ? 'left-[calc(50%-5rem)]' : 'left-[calc(50%+5rem)]',
        visible ? 'opacity-100' : 'opacity-0',
        !armed && 'pointer-events-none'
      )}>
      {children}
    </button>
  )
}

// The play/pause control in the middle of the video, between Previous and Next. Its disc is dark enough to hide
// YouTube's own button under it, which sits on the same spot and is 56px wide
export const CenterPlayButton = ({
  phase,
  controlsVisible,
  onToggle,
  onPrevious,
  onNext,
}: {
  phase: StagePhase
  controlsVisible: boolean
  onToggle: () => void
  onPrevious: () => void
  onNext: (() => void) | undefined
}) => {
  const youTubeCenterShowing = useYouTubeCenterShowing(phase)
  const visible = controlsVisible || youTubeCenterShowing
  // On a phone on its side, or a page turned by Lock Landscape (the `short:` variant covers both), the
  // lyrics lifted over the control bar reach the middle of the screen: there the bar's own play button is
  // enough, and this one shows only while it covers YouTube's
  const onlyForControls = !youTubeCenterShowing
  const armed = useArmed(visible)
  return (
    <>
      <StepButton
        label='Previous'
        side='start'
        visible={controlsVisible}
        onClick={onPrevious}>
        <SkipBackIcon className='size-6 fill-current' />
      </StepButton>
      <StepButton
        label='Next'
        side='end'
        visible={controlsVisible}
        onClick={onNext}>
        <SkipForwardIcon className='size-6 fill-current' />
      </StepButton>
      <button
        type='button'
        tabIndex={-1}
        aria-label={phase.kind === 'playing' ? 'Pause' : 'Play'}
        aria-hidden={!visible}
        onClick={onToggle}
        className={cn(
          'absolute top-(--video-cy) left-1/2 z-26 grid size-16 -translate-1/2 place-items-center rounded-full bg-black/60 text-white shadow-stage backdrop-blur-md transition-opacity duration-300',
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
