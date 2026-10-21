import {
  ExpandIcon,
  LockIcon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ShrinkIcon,
  SmartphoneIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Slider } from '@/components/ui/slider'
import { useArmed } from '@/hooks/use-armed'
import { useLandscapeLock } from '@/hooks/use-landscape-lock'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import { StageLock } from './stage-lock'
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
      'grid size-9 shrink-0 place-items-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none touch:size-11',
      active === true && 'text-primary-text hover:text-primary-text',
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
  fullscreen: boolean
  onToggleFullscreen: () => void
  zoomed: boolean
  onToggleZoom: () => void
  onSeekBy: (seconds: number) => void
  volume: PlayerVolume
  onVolumeChange: (volume: PlayerVolume) => void
  // Touch lock: the stage ignores every tap and swipe until unlocked
  locked: boolean
  onLockedChange: (locked: boolean) => void
}

const Clock = ({
  time,
  duration,
  className,
}: {
  time: number
  duration: number
  className: string
}) => (
  <span
    className={cn(
      'min-w-0 truncate text-sm whitespace-nowrap text-white tabular-nums',
      className
    )}>
    {formatTime(time)} / {formatTime(duration)}
  </span>
)

export const CONTROLS_FADE_MS = 300
const FADE_VARS: CssVars = { '--controls-fade': `${CONTROLS_FADE_MS}ms` }
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
  fullscreen,
  onToggleFullscreen,
  zoomed,
  onToggleZoom,
  onSeekBy,
  volume,
  onVolumeChange: setVolume,
  locked,
  onLockedChange,
}: StageControlsProps) => {
  const armed = useArmed(visible)
  const landscape = useLandscapeLock()
  const barRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observe = (bar: HTMLDivElement, content: HTMLDivElement) => {
      // Published for what floats above the controls: the lyrics, the rail in portrait, notices and the
      // generation button (see --stage-chrome-h)
      const root = document.documentElement
      const observer = new ResizeObserver(() => {
        // The gradient above the controls is see-through, so only the rows count
        const height = bar.clientHeight - content.offsetTop + OBSTRUCTION_GAP_PX
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
  }, [])

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
    <>
      {/* Settings for the whole sitting rather than the song, so they keep out of the thumb's way: top right,
          under the top bar. Touch screens only */}
      <div
        data-player-chrome
        className={cn(
          'hidden absolute top-(--stage-corner-top) right-controls-right z-30 items-center gap-0.5 rounded-full bg-black/55 p-0.5 shadow-rail backdrop-blur-md transition-opacity duration-(--controls-fade) touch:flex',
          visible ? 'opacity-100' : 'opacity-0',
          !armed && 'pointer-events-none'
        )}
        style={FADE_VARS}>
        <IconButton
          label='Lock Landscape'
          active={landscape.locked}
          onClick={() => {
            void landscape.toggle()
          }}
          className='rounded-full'>
          <SmartphoneIcon className='size-5 rotate-90' />
        </IconButton>
        <IconButton
          label='Lock Screen'
          onClick={() => {
            onLockedChange(true)
          }}
          className='rounded-full'>
          <LockIcon className='size-5' />
        </IconButton>
      </div>
      {locked && (
        <StageLock
          onUnlock={() => {
            onLockedChange(false)
          }}
        />
      )}
      <div
        ref={barRef}
        style={FADE_VARS}
        className={cn(
          'absolute inset-x-0 bottom-0 z-30 bg-linear-to-t from-black/80 via-black/40 to-transparent pt-10 pr-controls-right pb-controls-bottom pl-controls-left transition-opacity duration-(--controls-fade) short:pl-controls-rail',
          visible ? 'opacity-100' : 'opacity-0',
          !armed && 'pointer-events-none'
        )}>
        {/* On a phone on its side the seek bar joins the buttons' row: two rows would cover a third of the
          screen and push the lyrics to its middle */}
        <div
          ref={contentRef}
          data-player-chrome
          className='short:flex short:items-center short:gap-1'>
          {/* On a touch screen the clock sits at the end of the seek bar, so the buttons' row fits at 320px */}
          <div className='mb-2 flex items-center gap-3 short:contents'>
            <Slider
              aria-label='Seek'
              min={0}
              max={Math.max(duration, 1)}
              step={0.1}
              value={[shown]}
              onValueChange={([value]) => {
                setHeld(
                  value === undefined ? null : { committed: false, value }
                )
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
              className='min-w-0 flex-1 cursor-pointer short:order-1 short:mx-2'
            />
            <Clock
              time={shown}
              duration={duration}
              className='hidden shrink-0 touch:block short:order-2'
            />
          </div>
          <div className='flex items-center gap-1 touch:gap-0.5 short:contents'>
            {/* Bottom left, where every player has it, although touch screens also have one mid-stage */}
            <IconButton
              label={isPlaying ? 'Pause' : 'Play'}
              onClick={() => {
                player.togglePlay()
              }}>
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
            <Clock
              time={shown}
              duration={duration}
              className='ml-2 touch:hidden short:order-2 short:ml-0 short:shrink-0'
            />
            <div className='ml-auto flex shrink-0 items-center gap-1 touch:gap-0.5 short:order-3 short:ml-1'>
              <IconButton
                label='Loop'
                active={loop}
                onClick={() => {
                  onLoopChange(!loop)
                }}>
                <RepeatIcon className='size-5' />
              </IconButton>
              <IconButton
                label='Zoom to Fill'
                active={zoomed}
                onClick={onToggleZoom}>
                {zoomed ? (
                  <ShrinkIcon className='size-5' />
                ) : (
                  <ExpandIcon className='size-5' />
                )}
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
    </>
  )
}
