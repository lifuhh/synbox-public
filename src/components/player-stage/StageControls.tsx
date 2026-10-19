import {
  MaximizeIcon,
  MinimizeIcon,
  MousePointerClickIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Slider } from '@/components/ui/slider'
import { cn } from '@/utils/cn'

import type { PlayerVolume, StagePlayer } from './useYouTubePlayer'

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

interface IconButtonProps {
  label: string
  onClick: () => void
  active?: boolean
  children: React.ReactNode
}

const IconButton = ({ label, onClick, active, children }: IconButtonProps) => (
  <button
    type='button'
    aria-label={label}
    title={label}
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      'grid size-9 place-items-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
      active === true && 'text-primary hover:text-primary'
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
  // Height the controls occupy above the stage bottom, plus a small gap
  onHeightChange: (px: number) => void
  volume: PlayerVolume
  onVolumeChange: (volume: PlayerVolume) => void
}

export const CONTROLS_FADE_MS = 300
const OBSTRUCTION_GAP_PX = 8
const VOLUME_WHEEL_STEP = 0.05

export const StageControls = ({
  player,
  visible,
  loop,
  onLoopChange,
  interactive,
  onInteractiveChange,
  fullscreen,
  onToggleFullscreen,
  onHeightChange,
  volume,
  onVolumeChange: setVolume,
}: StageControlsProps) => {
  const barRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const bar = barRef.current
    const content = contentRef.current
    if (!(bar && content)) {
      return
    }
    // The gradient above the controls is see-through, so only the rows count
    const observer = new ResizeObserver(() => {
      onHeightChange(bar.clientHeight - content.offsetTop + OBSTRUCTION_GAP_PX)
    })
    observer.observe(bar)
    observer.observe(content)
    return () => {
      observer.disconnect()
    }
  }, [onHeightChange])

  const time = usePlaybackClock(player)
  const duration = player.getDuration()
  const [scrub, setScrub] = useState<number | null>(null)
  const isPlaying =
    player.phase.kind === 'playing' || player.phase.kind === 'buffering'

  return (
    <div
      ref={barRef}
      style={{ transitionDuration: `${CONTROLS_FADE_MS}ms` }}
      className={cn(
        'absolute inset-x-0 bottom-0 z-30 bg-linear-to-t from-black/80 via-black/40 to-transparent px-4 pt-10 pb-3 transition-opacity',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}>
      <div ref={contentRef}>
        <Slider
          aria-label='Seek'
          min={0}
          max={Math.max(duration, 1)}
          step={0.1}
          value={[scrub ?? time]}
          onValueChange={([value]) => {
            setScrub(value ?? null)
          }}
          onValueCommit={([value]) => {
            if (value !== undefined) {
              player.seek(value)
            }
            setScrub(null)
          }}
          className='mb-2 cursor-pointer'
        />
        <div className='flex items-center gap-1 text-sm text-white tabular-nums'>
          <IconButton
            label={isPlaying ? 'Pause' : 'Play'}
            onClick={player.togglePlay}>
            {isPlaying ? (
              <PauseIcon className='size-5' />
            ) : (
              <PlayIcon className='size-5' />
            )}
          </IconButton>
          {/* The slider only opens while the volume button is hovered or focused */}
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
            <div className='flex h-9 w-0 items-center overflow-hidden transition-[width] duration-200 ease-out group-focus-within/volume:w-24 group-hover/volume:w-24'>
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
          <span className='ml-2 whitespace-nowrap'>
            {formatTime(scrub ?? time)} / {formatTime(duration)}
          </span>
          <div className='ml-auto flex items-center gap-1'>
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
