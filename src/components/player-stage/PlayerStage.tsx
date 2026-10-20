import { useAtom, useSetAtom } from 'jotai'
import {
  LoaderIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  VolumeXIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '@/components/ui/use-toast'
import { playerChromeOpenAtom, playerVolumeAtom } from '@/context/atoms'
import { useArmed } from '@/hooks/useArmed'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { isStandalone } from '@/lib/pwa'
import { cn } from '@/utils/cn'

import { StageControls } from './StageControls'
import type { PlayerVolume, StagePhase, StagePlayer } from './useYouTubePlayer'
import { useYouTubePlayer } from './useYouTubePlayer'
import type { YouTubeQuirks } from './youtubeQuirks'

const IDLE_MS = 1800
// How long an unmuted autoplay gets to start before retrying muted
const AUTOPLAY_CHECK_MS = 1500
const SEEK_STEP_SEC = 5
const VOLUME_STEP = 0.05

const COVERED_PHASES = new Set<StagePhase['kind']>([
  'loading',
  'ready',
  'starting',
  'paused',
  'ended',
])

// Anything marked data-player-chrome holds the floating UI open while a menu from it is open, and with a
// mouse also while the pointer rests on it or keyboard focus is inside it. A touch screen counts menus
// only: iOS keeps the last tapped element in :hover, and a dragged slider keeps its thumb focused, so
// either would hold the UI open for good
const chromeBusy = () => {
  const canHover = matchMedia('(hover: hover)').matches
  return [...document.querySelectorAll('[data-player-chrome]')].some(
    (element) =>
      // aria-expanded rather than data-state, which a tooltip on the same trigger overwrites
      element.querySelector('[aria-expanded=true]') !== null ||
      (canHover &&
        (element.matches(':hover') ||
          element.querySelector(':focus-visible') !== null))
  )
}

// Idle `ms` after the last pointer or key input anywhere in the window, and not while the UI is busy
const useIdle = (ms: number) => {
  const [idle, setIdle] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const wake = useCallback(() => {
    setIdle(false)
    clearTimeout(timerRef.current)
    const check = () => {
      if (chromeBusy()) {
        timerRef.current = setTimeout(check, ms)
      } else {
        setIdle(true)
      }
    }
    timerRef.current = setTimeout(check, ms)
  }, [ms])
  const sleep = () => {
    clearTimeout(timerRef.current)
    setIdle(true)
  }

  useEffect(() => {
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timerRef.current)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [wake])
  return { idle, sleep }
}

const clampVolume = (level: number) => ({
  level: Math.min(1, Math.max(0, level)),
  muted: false,
})

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

const StageCover = ({
  videoId,
  phase,
}: {
  videoId: string
  phase: StagePhase
}) => {
  const [thumb, setThumb] = useState('maxresdefault')
  const dimmed = phase.kind === 'paused' || phase.kind === 'ended'
  return (
    <div className='pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-hidden bg-black'>
      <img
        src={`https://i.ytimg.com/vi/${videoId}/${thumb}.jpg`}
        alt=''
        onError={() => {
          setThumb('hqdefault')
        }}
        className={cn(
          'absolute inset-0 size-full object-cover transition-[filter,opacity] duration-300',
          dimmed && 'scale-105 opacity-60 blur-md'
        )}
      />
      <div className='relative text-white drop-shadow-[0_2px_6px_rgb(0_0_0/0.8)]'>
        {(phase.kind === 'loading' || phase.kind === 'starting') && (
          <LoaderIcon className='size-14 animate-spin' />
        )}
        {(phase.kind === 'ready' || phase.kind === 'paused') && (
          <PlayIcon className='size-20 fill-current opacity-90' />
        )}
        {phase.kind === 'ended' && <RotateCcwIcon className='size-16' />}
      </div>
    </div>
  )
}

export interface StageLayout {
  // Stage pixels our controls cover from the bottom right now; 0 while hidden
  bottomObstruction: number
  // Controls stay hidden while dragging, so the drop position is the real one
  onDragChange: (dragging: boolean) => void
}

interface PlayerStageProps {
  videoId: string
  quirks: YouTubeQuirks
  renderLyrics?: (player: StagePlayer, layout: StageLayout) => ReactNode
  // Start playing once this turns true (e.g. when the lyrics have loaded)
  autoplay?: boolean
  onFirstPlay?: () => void
  onEvent?: (message: string) => void
  className?: string
}

export const PlayerStage = ({
  videoId,
  quirks,
  renderLyrics,
  autoplay = false,
  onFirstPlay,
  onEvent,
  className,
}: PlayerStageProps) => {
  const stageRef = useRef<HTMLDivElement>(null)
  const [storedVolume, setStoredVolume] = useAtom(playerVolumeAtom)
  // Browsers block unmuted autoplay until the viewer has interacted with the
  // site; the muted retry is temporary and never written to storedVolume
  const [autoplayMuted, setAutoplayMuted] = useState(false)
  const volume = autoplayMuted ? { ...storedVolume, muted: true } : storedVolume
  const setVolume = (next: PlayerVolume) => {
    setAutoplayMuted(false)
    setStoredVolume(next)
  }
  const [loop, setLoop] = useState(false)
  const [interactive, setInteractive] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const player = useYouTubePlayer({ videoId, quirks, volume, loop, onEvent })
  const { phase } = player

  const autoplayedRef = useRef(false)
  const { play } = player
  const phaseKindRef = useRef(phase.kind)
  useEffect(() => {
    phaseKindRef.current = phase.kind
  }, [phase.kind])
  const isReady = phase.kind === 'ready'
  // The check lives in a ref, not the effect's cleanup: play() moves the phase
  // off 'ready', which re-runs this effect and would cancel the check
  const autoplayCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (autoplayCheckRef.current) {
        clearTimeout(autoplayCheckRef.current)
      }
    },
    []
  )
  useEffect(() => {
    if (!(autoplay && isReady) || autoplayedRef.current) {
      return
    }
    autoplayedRef.current = true
    play()
    // A blocked unmuted play leaves YouTube unstarted without an error
    autoplayCheckRef.current = setTimeout(() => {
      const kind = phaseKindRef.current
      if (kind !== 'playing' && kind !== 'buffering') {
        setAutoplayMuted(true)
        play({ muted: true })
      }
    }, AUTOPLAY_CHECK_MS)
  }, [autoplay, isReady, play])

  const firstPlayRef = useRef(false)
  const isPlaying = phase.kind === 'playing'
  useEffect(() => {
    if (isPlaying && !firstPlayRef.current) {
      firstPlayRef.current = true
      onFirstPlay?.()
    }
  }, [isPlaying, onFirstPlay])
  const { idle, sleep } = useIdle(IDLE_MS)
  const [dragging, setDragging] = useState(false)
  const [controlsHeight, setControlsHeight] = useState(0)

  // YouTube's own error screens (unavailable, sign-in, age gate) need its UI
  const handsOff = interactive || phase.kind === 'error'
  const showCover =
    !handsOff &&
    (COVERED_PHASES.has(phase.kind) ||
      (phase.kind === 'playing' && !phase.settled))
  const controlsVisible = !dragging && (!idle || phase.kind !== 'playing')
  const { toast } = useToast()
  const touch = useMediaQuery('(pointer: coarse)')
  const centerControl = touch && controlsVisible
  const centerArmed = useArmed(centerControl)
  const setChromeOpen = useSetAtom(playerChromeOpenAtom)
  useEffect(() => {
    setChromeOpen(controlsVisible)
  }, [controlsVisible, setChromeOpen])
  useEffect(
    () => () => {
      setChromeOpen(true)
    },
    [setChromeOpen]
  )
  const layout: StageLayout = {
    bottomObstruction: controlsVisible ? controlsHeight : 0,
    onDragChange: (next) => {
      setDragging(next)
      // After a drop, keep the controls away until the pointer moves again
      if (!next) {
        sleep()
      }
    },
  }

  // A first tap on a touch screen only brings the controls back; it does not also pause
  const revealOnlyRef = useRef(false)

  const toggleFullscreen = () => {
    // iPhone Safari cannot put a page in fullscreen; only the Home Screen app runs without its bars
    if (!document.fullscreenEnabled) {
      toast({
        description:
          'Add Synbox to your Home Screen (Share › Add to Home Screen) to play without Safari’s bars.',
        duration: 5000,
        title: 'Full Screen on iPhone',
      })
      return
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void stageRef.current?.requestFullscreen()
    }
  }

  useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement === stageRef.current)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target) || event.metaKey || event.ctrlKey) {
        return
      }
      const onSlider =
        event.target instanceof HTMLElement &&
        event.target.getAttribute('role') === 'slider'
      switch (event.key) {
        case ' ':
        case 'k': {
          player.togglePlay()
          break
        }
        case 'ArrowLeft': {
          if (onSlider) {
            return
          }
          player.seek(Math.max(0, player.getTime() - SEEK_STEP_SEC))
          break
        }
        case 'ArrowRight': {
          if (onSlider) {
            return
          }
          player.seek(player.getTime() + SEEK_STEP_SEC)
          break
        }
        case 'ArrowUp': {
          if (onSlider) {
            return
          }
          setVolume(clampVolume(volume.level + VOLUME_STEP))
          break
        }
        case 'ArrowDown': {
          if (onSlider) {
            return
          }
          setVolume(clampVolume(volume.level - VOLUME_STEP))
          break
        }
        case 'm': {
          setVolume({ ...volume, muted: !volume.muted })
          break
        }
        case 'f': {
          toggleFullscreen()
          break
        }
        default: {
          return
        }
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  })

  return (
    <div
      ref={stageRef}
      data-player-stage
      data-phase={phase.kind}
      className={cn(
        '[container-type:size] relative size-full overflow-hidden bg-black',
        !controlsVisible && 'cursor-none',
        className
      )}>
      <div
        className='absolute top-1/2 left-1/2 aspect-video -translate-1/2 overflow-hidden'
        style={{ width: 'min(100cqw, 177.78cqh)' }}>
        <div
          ref={player.hostRef}
          className={cn(
            'absolute inset-x-0 [&>iframe]:size-full',
            quirks.blockIframeInput &&
              !handsOff &&
              '[&>iframe]:pointer-events-none'
          )}
          style={{ top: -quirks.cropPx, bottom: -quirks.cropPx }}
        />
        {showCover && <StageCover videoId={videoId} phase={phase} />}
      </div>

      {/* YouTube shows its own center button for about 4s after every play or seek; this covers that spot,
          opaque so none of it shows through. On a touch screen it is also the play/pause control, shown
          with the rest of the floating UI as in YouTube's own app. It sits outside the video box so it
          draws above the lyrics; the video is always centred on the stage */}
      {!showCover && !handsOff && (player.centerMasked || centerControl) && (
        <button
          type='button'
          tabIndex={-1}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={player.togglePlay}
          className={cn(
            'absolute top-1/2 left-1/2 z-26 grid size-20 -translate-1/2 place-items-center rounded-full bg-neutral-950 text-white shadow-[0_4px_16px_rgb(0_0_0/0.35)] ring-1 ring-white/10',
            !centerArmed && 'pointer-events-none'
          )}>
          {phase.kind === 'paused' ? (
            <PlayIcon className='size-9 fill-current' />
          ) : (
            <PauseIcon className='size-9 fill-current' />
          )}
        </button>
      )}

      {quirks.blockIframeInput && !handsOff && (
        <div
          data-testid='stage-input'
          aria-hidden='true'
          className={cn(
            'absolute inset-0 z-20',
            controlsVisible && 'cursor-pointer'
          )}
          onPointerDown={(event) => {
            revealOnlyRef.current =
              event.pointerType !== 'mouse' && !controlsVisible
          }}
          onClick={() => {
            if (!revealOnlyRef.current) {
              player.togglePlay()
            }
          }}
          onDoubleClick={toggleFullscreen}
        />
      )}

      {autoplayMuted && (
        <button
          type='button'
          onClick={() => {
            setVolume({ ...storedVolume, muted: false })
          }}
          className='absolute top-[calc(var(--topbar-h)+0.5rem+var(--notices-h,0px)+var(--preview-banner-h,0px))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-black/60 px-5 py-2.5 text-base font-medium text-white shadow-lg ring-1 ring-white/20 backdrop-blur-md transition-colors hover:bg-black/80'>
          <VolumeXIcon className='size-5' aria-hidden='true' />
          Tap to Unmute
        </button>
      )}

      {renderLyrics && (
        // In portrait the lyrics get the space between the video and the controls
        <div className='pointer-events-none absolute inset-0 z-25 portrait:top-[calc(50cqh+28.125cqw+0.5rem)]'>
          {renderLyrics(player, layout)}
        </div>
      )}

      <StageControls
        player={player}
        visible={controlsVisible}
        loop={loop}
        onLoopChange={setLoop}
        interactive={interactive}
        onInteractiveChange={setInteractive}
        fullscreen={fullscreen}
        // The Home Screen app is already full screen where the page cannot go fullscreen itself
        fullscreenAvailable={document.fullscreenEnabled || !isStandalone()}
        onToggleFullscreen={toggleFullscreen}
        onHeightChange={setControlsHeight}
        volume={volume}
        onVolumeChange={setVolume}
      />
    </div>
  )
}
