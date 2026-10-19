import { useAtom } from 'jotai'
import {
  LoaderIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  VolumeXIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { playerVolumeAtom } from '@/context/atoms'
import { cn } from '@/utils/cn'

import { StageControls } from './StageControls'
import type { PlayerVolume, StagePhase, StagePlayer } from './useYouTubePlayer'
import { useYouTubePlayer } from './useYouTubePlayer'
import type { YouTubeQuirks } from './youtubeQuirks'

const IDLE_MS = 2500
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

const useIdle = (ms: number) => {
  const [idle, setIdle] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wake = () => {
    setIdle(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      setIdle(true)
    }, ms)
  }
  const sleep = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    setIdle(true)
  }
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    },
    []
  )
  return { idle, wake, sleep }
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
  const { idle, wake, sleep } = useIdle(IDLE_MS)
  const [dragging, setDragging] = useState(false)
  const [controlsHeight, setControlsHeight] = useState(0)

  // YouTube's own error screens (unavailable, sign-in, age gate) need its UI
  const handsOff = interactive || phase.kind === 'error'
  const showCover =
    !handsOff &&
    (COVERED_PHASES.has(phase.kind) ||
      (phase.kind === 'playing' && !phase.settled))
  const controlsVisible = !dragging && (!idle || phase.kind !== 'playing')
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

  const toggleFullscreen = () => {
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
      wake()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  })

  return (
    <div
      ref={stageRef}
      data-phase={phase.kind}
      className={cn(
        '[container-type:size] relative size-full overflow-hidden bg-black',
        !controlsVisible && 'cursor-none',
        className
      )}
      onPointerMove={wake}
      onPointerDown={wake}>
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
        {!showCover && !handsOff && player.centerMasked && (
          <div className='pointer-events-none absolute top-1/2 left-1/2 z-10 grid size-20 -translate-1/2 place-items-center rounded-full bg-black/85 text-white'>
            {phase.kind === 'paused' ? (
              <PlayIcon className='size-9 fill-current' />
            ) : (
              <PauseIcon className='size-9 fill-current' />
            )}
          </div>
        )}
      </div>

      {quirks.blockIframeInput && !handsOff && (
        <div
          data-testid='stage-input'
          aria-hidden='true'
          className='absolute inset-0 z-20'
          onClick={player.togglePlay}
          onDoubleClick={toggleFullscreen}
        />
      )}

      {autoplayMuted && (
        <button
          type='button'
          onClick={() => {
            setVolume({ ...storedVolume, muted: false })
          }}
          className='absolute top-18 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-black/60 px-5 py-2.5 text-base font-medium text-white shadow-lg ring-1 ring-white/20 backdrop-blur-md transition-colors hover:bg-black/80'>
          <VolumeXIcon className='size-5' aria-hidden='true' />
          Tap to Unmute
        </button>
      )}

      {renderLyrics && (
        <div className='pointer-events-none absolute inset-0 z-25'>
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
        onToggleFullscreen={toggleFullscreen}
        onHeightChange={setControlsHeight}
        volume={volume}
        onVolumeChange={setVolume}
      />
    </div>
  )
}
