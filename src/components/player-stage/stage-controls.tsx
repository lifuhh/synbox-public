import {
  MaximizeIcon,
  MinimizeIcon,
  MousePointerClickIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Slider } from '@/components/ui/slider'
import { useArmed } from '@/hooks/use-armed'
import { cn } from '@/utils/cn'

import { TAP_SEEK_SEC } from './use-stage-taps'
import type { PlayerVolume, StagePlayer } from './use-you-tube-player'

const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

const usePlaybackClock = ({ subscribeFrame }: StagePlayer) => {
  const [time, setTime] = useState(0)
  useEffect(
    () =>
      subscribeFrame((next) => {
        setTime((current) =>
          Math.floor(current * 4) === Math.floor(next * 4) ? current : next
        )
      }),
    [subscribeFrame]
  )
  return time
}

const VolumeGlyph = ({ level, muted }: { level: number; muted: boolean }) => {
  if (muted || level === 0) {
    return <VolumeXIcon className='size-5' />
  }
  return level < 0.5 ? (
    <Volume1Icon className='size-5' />
  ) : (
    <Volume2Icon className='size-5' />
  )
}

// A circular arrow around the number of seconds it skips
const SeekGlyph = ({ direction }: { direction: 'back' | 'forward' }) => (
  <span className='relative grid size-6 place-items-center'>
    {direction === 'back' ? (
      <RotateCcwIcon className='absolute size-6' strokeWidth={1.75} />
    ) : (
      <RotateCwIcon className='absolute size-6' strokeWidth={1.75} />
    )}
    <span className='pt-px text-micro leading-none font-bold'>
      {TAP_SEEK_SEC}
    </span>
  </span>
)

interface IconButtonProps {
  label: string
  onClick: () => void
  active?: boolean
  className?: string
  children: React.ReactNode
}

const IconButton = ({
  label,
  onClick,
  active,
  className,
  children,
}: IconButtonProps) => (
  <button
    type='button'
    aria-label={label}
    title={label}
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      'grid size-9 shrink-0 place-items-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none touch:size-10',
      active === true && 'text-primary hover:text-primary',
      className
    )}>
    {children}
  </button>
)

interface StageControlsProps {
  player: StagePlayer
  visible: boolean
  loop: boolean
  onLoopChange: (loop: boolean) => void
  interactive: boolean
  onInteractiveChange: (interactive: boolean) => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  onSeekBy: (seconds: number) => void
  // Height the controls occupy above the stage bottom, plus a small gap
  onHeightChange: (px: number) => void
  volume: PlayerVolume
  onVolumeChange: (volume: PlayerVolume) => void
}

export const CONTROLS_FADE_MS = 300
const OBSTRUCTION_GAP_PX = 8
const VOLUME_WHEEL_STEP = 0.05
// The clock counts a seek as landed within this of its target
const SEEK_SETTLED_SEC = 1
const SEEK_HOLD_MAX_MS = 3000

export const StageControls = ({
  player,
  visible,
  loop,
  onLoopChange,
  interactive,
  onInteractiveChange,
  fullscreen,
  onToggleFullscreen,
  onSeekBy,
  onHeightChange,
  volume,
  onVolumeChange: setVolume,
}: StageControlsProps) => {
  const armed = useArmed(visible)
  const barRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observe = (bar: HTMLDivElement, content: HTMLDivElement) => {
      // Published for the generation button, which floats above the controls on the player
      const root = document.documentElement
      const observer = new ResizeObserver(() => {
        // The gradient above the controls is see-through, so only the rows count
        const height = bar.clientHeight - content.offsetTop + OBSTRUCTION_GAP_PX
        onHeightChange(height)
        root.style.setProperty('--stage-controls-h', `${height}px`)
      })
      observer.observe(bar)
      observer.observe(content)
      return () => {
        observer.disconnect()
        root.style.removeProperty('--stage-controls-h')
      }
    }
    const barNode = barRef.current
    const contentNode = contentRef.current
    return barNode && contentNode ? observe(barNode, contentNode) : undefined
  }, [onHeightChange])

  const time = usePlaybackClock(player)
  const duration = player.getDuration()
  // What the seek bar shows in place of the clock: the value under the pointer while dragging, then the
  // committed target until the clock reaches it, so the thumb never drops back to the old time for the
  // frame before the player reports the seek
  const [held, setHeld] = useState<{
    value: number
    committed: boolean
  } | null>(null)
  if (
    held?.committed === true &&
    Math.abs(time - held.value) < SEEK_SETTLED_SEC
  ) {
    setHeld(null)
  }
  const releaseRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  useEffect(
    () => () => {
      clearTimeout(releaseRef.current)
    },
    []
  )
  const shown = held?.value ?? time
  const isPlaying =
    player.phase.kind === 'playing' || player.phase.kind === 'buffering'

  return (
    <div
      ref={barRef}
      style={{ transitionDuration: `${CONTROLS_FADE_MS}ms` }}
      className={cn(
        'absolute inset-x-0 bottom-0 z-30 bg-linear-to-t from-black/80 via-black/40 to-transparent pt-10 pr-controls-right pb-controls-bottom pl-controls-left transition-opacity short:pl-controls-rail',
        visible ? 'opacity-100' : 'opacity-0',
        !armed && 'pointer-events-none'
      )}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}>
      <div ref={contentRef} data-player-chrome>
        <Slider
          aria-label='Seek'
          min={0}
          max={Math.max(duration, 1)}
          step={0.1}
          value={[shown]}
          onValueChange={([value]) => {
            setHeld(value === undefined ? null : { committed: false, value })
          }}
          onValueCommit={([value]) => {
            if (value === undefined) {
              setHeld(null)
              return
            }
            player.seek(value)
            setHeld({ committed: true, value })
            // A seek the player never reports lets go of the bar anyway
            clearTimeout(releaseRef.current)
            releaseRef.current = setTimeout(() => {
              setHeld(null)
            }, SEEK_HOLD_MAX_MS)
          }}
          className='mb-2 cursor-pointer'
        />
        <div className='flex items-center gap-1 text-sm text-white tabular-nums touch:gap-0.5'>
          {/* Touch screens play and pause from the button in the middle of the stage instead */}
          <IconButton
            label={isPlaying ? 'Pause' : 'Play'}
            onClick={() => {
              player.togglePlay()
            }}
            className='touch:hidden'>
            {isPlaying ? (
              <PauseIcon className='size-5' />
            ) : (
              <PlayIcon className='size-5' />
            )}
          </IconButton>
          <IconButton
            label={`Back ${TAP_SEEK_SEC} Seconds`}
            onClick={() => {
              onSeekBy(-TAP_SEEK_SEC)
            }}>
            <SeekGlyph direction='back' />
          </IconButton>
          <IconButton
            label={`Forward ${TAP_SEEK_SEC} Seconds`}
            onClick={() => {
              onSeekBy(TAP_SEEK_SEC)
            }}>
            <SeekGlyph direction='forward' />
          </IconButton>
          {/* The slider only opens while the volume button is hovered or focused, so touch screens
              keep just the mute button and the device's own volume */}
          <div
            className='group/volume flex items-center'
            onWheel={(event) => {
              const step =
                event.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP
              setVolume({
                level: Math.min(1, Math.max(0, volume.level + step)),
                muted: false,
              })
            }}>
            <IconButton
              label={volume.muted ? 'Unmute' : 'Mute'}
              onClick={() => {
                setVolume({ ...volume, muted: !volume.muted })
              }}>
              <VolumeGlyph level={volume.level} muted={volume.muted} />
            </IconButton>
            <div className='flex h-9 w-0 items-center overflow-hidden transition-width duration-200 ease-out group-focus-within/volume:w-24 group-hover/volume:w-24 touch:hidden'>
              <div className='w-24 shrink-0 px-2.5'>
                <Slider
                  aria-label='Volume'
                  min={0}
                  max={1}
                  step={0.01}
                  value={[volume.muted ? 0 : volume.level]}
                  onValueChange={([value]) => {
                    if (value !== undefined) {
                      setVolume({ level: value, muted: false })
                    }
                  }}
                  className='cursor-pointer'
                />
              </div>
            </div>
          </div>
          <span className='ml-2 min-w-0 truncate whitespace-nowrap touch:ml-1'>
            {formatTime(shown)} / {formatTime(duration)}
          </span>
          <div className='ml-auto flex shrink-0 items-center gap-1 touch:gap-0.5'>
            <IconButton
              label='Loop'
              active={loop}
              onClick={() => {
                onLoopChange(!loop)
              }}>
              <RepeatIcon className='size-5' />
            </IconButton>
            <IconButton
              label='Interact With YouTube'
              active={interactive}
              onClick={() => {
                onInteractiveChange(!interactive)
              }}>
              <MousePointerClickIcon className='size-5' />
            </IconButton>
            <IconButton
              label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              onClick={onToggleFullscreen}>
              {fullscreen ? (
                <MinimizeIcon className='size-5' />
              ) : (
                <MaximizeIcon className='size-5' />
              )}
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  )
}
