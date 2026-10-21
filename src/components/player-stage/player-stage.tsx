import { useAtom, useSetAtom } from 'jotai'
import {
  LoaderIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  VolumeXIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '@/components/ui/use-toast'
import { playerChromeOpenAtom, playerVolumeAtom } from '@/context/atoms'
import { useArmed } from '@/hooks/use-armed'
import { isStandalone } from '@/lib/pwa'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import { clampSeek, HOLD_JUMP_MS, holdStep } from './seek-steps'
import { StageControls } from './stage-controls'
import type { SeekFlash } from './use-stage-taps'
import { useStageTaps } from './use-stage-taps'
import type {
  PlayerVolume,
  StagePhase,
  StagePlayer,
} from './use-you-tube-player'
import { useYouTubePlayer } from './use-you-tube-player'
import type { YouTubeQuirks } from './youtube-quirks'

const IDLE_MS = 1800
// How long an unmuted autoplay gets to start before retrying muted
const AUTOPLAY_CHECK_MS = 1500
const VOLUME_STEP = 0.05

const COVERED_PHASES = new Set<StagePhase['kind']>([
  'loading',
  'ready',
  'starting',
  'ended',
])

// A pause leaves the frame in view: with controls=0 YouTube draws nothing over a paused video
const coversPhase = (phase: StagePhase) =>
  COVERED_PHASES.has(phase.kind) || (phase.kind === 'playing' && !phase.settled)

const markImmersive = () => {
  const root = document.documentElement
  root.dataset.immersive = ''
  return () => {
    delete root.dataset.immersive
  }
}

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
    // oxlint-disable-next-line react/set-state-in-effect -- arriving on the stage counts as activity: show the controls and start the idle timer
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

const CenterPlayButton = ({
  phase,
  visible,
  armed,
  onToggle,
}: {
  phase: StagePhase
  visible: boolean
  armed: boolean
  onToggle: () => void
}) => (
  <button
    type='button'
    tabIndex={-1}
    aria-label={phase.kind === 'playing' ? 'Pause' : 'Play'}
    aria-hidden={!visible}
    onClick={onToggle}
    className={cn(
      'absolute top-(--video-cy) left-1/2 z-26 grid size-20 -translate-1/2 place-items-center rounded-full bg-primary-subtle text-primary-text shadow-stage transition-opacity duration-300 short:size-14',
      visible ? 'opacity-100' : 'opacity-0',
      !armed && 'pointer-events-none'
    )}>
    {phase.kind === 'paused' ? (
      <PlayIcon className='size-9 fill-current short:size-6' />
    ) : (
      <PauseIcon className='size-9 fill-current short:size-6' />
    )}
  </button>
)

const SeekFlashBadge = ({ flash }: { flash: SeekFlash }) => (
  <div
    className={cn(
      'pointer-events-none absolute top-(--video-cy) z-26 flex w-1/3 -translate-y-1/2 justify-center',
      flash.side === 'back' ? 'left-0' : 'right-0'
    )}>
    <span
      key={flash.key}
      className='flex animate-in items-center gap-1 rounded-full bg-black/55 px-4 py-2 text-base font-semibold text-white tabular-nums shadow-stage backdrop-blur-md zoom-in-90 fade-in'>
      {flash.side === 'back' ? (
        <RotateCcwIcon className='size-4' aria-hidden />
      ) : null}
      {flash.side === 'back' ? '−' : '+'}
      {flash.seconds}s
      {flash.side === 'forward' ? (
        <RotateCwIcon className='size-4' aria-hidden />
      ) : null}
    </span>
  </div>
)

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
  return (
    <div className='pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-hidden bg-black'>
      <img
        src={`https://i.ytimg.com/vi/${videoId}/${thumb}.jpg`}
        alt=''
        onError={() => {
          setThumb('hqdefault')
        }}
        className={cn(
          'absolute inset-0 size-full object-cover transition-opacity duration-300',
          phase.kind === 'ended' && 'opacity-60'
        )}
      />
      <div className='relative text-white drop-shadow-stage'>
        {(phase.kind === 'loading' || phase.kind === 'starting') && (
          <LoaderIcon className='size-14 animate-spin' />
        )}
        {phase.kind === 'ready' && (
          <PlayIcon className='size-20 fill-current opacity-90' />
        )}
        {phase.kind === 'ended' && <RotateCcwIcon className='size-16' />}
      </div>
    </div>
  )
}

export interface StageLayout {
  // While true the floating UI covers --stage-chrome-h of the stage's bottom edge
  controlsVisible: boolean
  // Controls stay hidden while dragging, so the drop position is the real one
  onDragChange: (dragging: boolean) => void
}

interface PlayerStageProps {
  videoId: string
  quirks: YouTubeQuirks
  renderLyrics?: (player: StagePlayer, layout: StageLayout) => ReactNode
  // Start playing once this turns true (e.g. when the lyrics have loaded)
  autoplay?: boolean
  onEvent?: (message: string) => void
  className?: string
}

export const PlayerStage = ({
  videoId,
  quirks,
  renderLyrics,
  autoplay = false,
  onEvent,
  className,
}: PlayerStageProps) => {
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
  const [fullscreen, setFullscreen] = useState(false)
  // iPhone Safari has no fullscreen for a page; there the button hides the app's own top bar instead
  const [immersive, setImmersive] = useState(false)
  const player = useYouTubePlayer({
    loop,
    onEvent,
    quirks,
    videoId,
    volume,
  })
  const { phase, hostRef } = player

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

  const { idle, sleep } = useIdle(IDLE_MS)
  const [dragging, setDragging] = useState(false)

  // YouTube's own error screens (unavailable, sign-in, age gate) need its UI
  const handsOff = phase.kind === 'error'
  const showCover = !handsOff && coversPhase(phase)
  const controlsVisible = !dragging && (!idle || phase.kind !== 'playing')
  const blockInput = quirks.blockIframeInput && !handsOff
  const { toast } = useToast()
  const centerArmed = useArmed(controlsVisible)
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
    controlsVisible,
    onDragChange: (next) => {
      setDragging(next)
      // After a drop, keep the controls away until the pointer moves again
      if (!next) {
        sleep()
      }
    },
  }

  // The whole page goes fullscreen, not just the stage, so the rail and the controls stay in reach.
  // Nothing locks the orientation: the player turns with the phone, either way round
  const toggleFullscreen = () => {
    if (!document.fullscreenEnabled) {
      // In Safari, unlike the Home Screen app, the browser's own bars stay; say how to lose them
      if (!immersive && !isStandalone()) {
        toast({
          description:
            'Add Synbox to your Home Screen (Share › Add to Home Screen) to hide Safari’s bars too.',
          duration: 5000,
          title: 'Full Screen on iPhone',
        })
      }
      setImmersive(!immersive)
      return
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }

  const seekBy = (seconds: number) => {
    player.seek(player.getTime() + seconds)
  }
  const taps = useStageTaps({
    controlsVisible,
    hideControls: sleep,
    seekBy,
    showCover,
    toggleFullscreen,
    togglePlay: player.togglePlay,
  })

  useEffect(() => (immersive ? markImmersive() : undefined), [immersive])

  useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement !== null)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
    }
  }, [])

  // The arrow key being held: how many jumps it has made, when the last one was, and where it aimed. A
  // held key's jumps build on that aim, since the player's own time lags a seek it has not finished
  const hold = useRef<{
    key: string
    jumps: number
    at: number
    target: number
  } | null>(null)
  const holdSeek = (event: KeyboardEvent) => {
    const held = event.repeat && hold.current?.key === event.key
    const now = performance.now()
    if (held && hold.current !== null && now - hold.current.at < HOLD_JUMP_MS) {
      return
    }
    const jumps = held && hold.current !== null ? hold.current.jumps : 0
    const from =
      held && hold.current !== null ? hold.current.target : player.getTime()
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const target = clampSeek(
      from + direction * holdStep(jumps),
      player.getDuration(),
      quirks.endGuardSec
    )
    player.seek(target)
    hold.current = { at: now, jumps: jumps + 1, key: event.key, target }
  }

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
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (onSlider) {
            return
          }
          holdSeek(event)
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
        case 'Escape': {
          if (!immersive) {
            return
          }
          setImmersive(false)
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

  const cropVars: CssVars = { '--iframe-crop': `${-quirks.cropPx}px` }
  return (
    <div
      data-player-stage
      data-phase={phase.kind}
      className={cn(
        // --video-cy is the video's vertical centre: the middle of the stage, in portrait too, with the lyrics
        // in the space below it
        '[container-type:size] relative size-full overflow-hidden bg-black [--video-cy:50cqh]',
        !controlsVisible && 'cursor-none',
        className
      )}>
      <div className='absolute top-(--video-cy) left-1/2 aspect-video w-[min(100cqw,177.78cqh)] -translate-1/2 overflow-hidden'>
        <div
          ref={hostRef}
          className={cn(
            'absolute inset-x-0 top-(--iframe-crop) bottom-(--iframe-crop) [&>iframe]:size-full',
            blockInput && '[&>iframe]:pointer-events-none'
          )}
          style={cropVars}
        />
        {showCover && <StageCover videoId={videoId} phase={phase} />}
      </div>

      {/* The play/pause control shows and hides with the rest of the floating UI. Opaque, so it also covers
          the flash YouTube draws in the same spot on a play or pause, which comes from input that has just
          shown the UI. It sits outside the video box so it draws above the lyrics */}
      {!showCover && !handsOff && (
        <CenterPlayButton
          phase={phase}
          visible={controlsVisible}
          armed={centerArmed}
          onToggle={() => {
            player.togglePlay()
          }}
        />
      )}

      {blockInput && (
        <div
          data-testid='stage-input'
          aria-hidden='true'
          className={cn(
            'absolute inset-0 z-20',
            controlsVisible && 'cursor-pointer'
          )}
          {...taps.handlers}
        />
      )}

      {taps.flash && <SeekFlashBadge flash={taps.flash} />}

      {autoplayMuted && (
        <button
          type='button'
          onClick={() => {
            setVolume({ ...storedVolume, muted: false })
          }}
          className='absolute top-[calc(var(--topbar-h)+0.5rem+var(--notices-h,0px)+var(--preview-banner-h,0px))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-black/60 px-5 py-2.5 text-base font-medium text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/80'>
          <VolumeXIcon className='size-5' aria-hidden='true' />
          Tap to Unmute
        </button>
      )}

      {renderLyrics && (
        // In portrait the lyrics get the space under the video; on a phone on its side they keep clear of the
        // rail's column and the notch. The floating UI at the bottom is cleared by DraggableLyrics' lift
        <div className='pointer-events-none absolute inset-0 z-25 portrait:top-[calc(var(--video-cy)+28.125cqw+0.5rem)] short:inset-x-controls-rail'>
          {renderLyrics(player, layout)}
        </div>
      )}

      <StageControls
        player={player}
        visible={controlsVisible}
        loop={loop}
        onLoopChange={setLoop}
        fullscreen={fullscreen || immersive}
        onToggleFullscreen={toggleFullscreen}
        onSeekBy={seekBy}
        volume={volume}
        onVolumeChange={setVolume}
      />
    </div>
  )
}
