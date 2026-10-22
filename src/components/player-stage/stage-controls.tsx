import { useAtom, useAtomValue } from 'jotai'
import {
  ExpandIcon,
  LockIcon,
  MaximizeIcon,
  MinimizeIcon,
  RectangleHorizontalIcon,
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
import { playerSurfaceAtom } from '@/context/atoms'
import { useArmed } from '@/hooks/use-armed'
import { useLandscapeLock } from '@/hooks/use-landscape-lock'
import { autoplayAtom } from '@/lib/listening/store'
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
      'grid size-9 shrink-0 place-items-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none touch:size-11 touch:watch-narrow:size-10 pills:size-10 pills:rounded-full',
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
  // Theater is offered on a wide watch page only
  theater: boolean
  onToggleTheater?: () => void
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

// One of the control bar's pills: a light glass behind a group of buttons, on a wide screen with a mouse. Over the
// bar's shade a dark pill vanished; a light one reads over dark and bright video alike
const PILL_GLASS = 'pills:rounded-full pills:bg-white/12 pills:backdrop-blur-md'
// A group of buttons on one glass; a lone button takes the glass alone and keeps its own centring
const PILL = `pills:flex pills:items-center ${PILL_GLASS}`

// Autoplay, where YouTube has it, first in the right-hand pill: on, the song at the top of the list beside the
// video plays when this one ends. The thumb's side and the track's brightness both show the state, and its
// glyph says play or pause
const AutoplaySwitch = () => {
  const [autoplay, setAutoplay] = useAtom(autoplayAtom)
  return (
    <button
      type='button'
      role='switch'
      aria-checked={autoplay}
      aria-label='Autoplay'
      title={autoplay ? 'Autoplay Is On' : 'Autoplay Is Off'}
      onClick={() => {
        setAutoplay(!autoplay)
      }}
      className='hidden h-10 w-13 shrink-0 place-items-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pills:grid'>
      <span
        className={cn(
          'flex h-3.5 w-9 items-center rounded-full transition-colors',
          autoplay ? 'bg-white/75' : 'bg-white/30'
        )}>
        <span
          className={cn(
            'grid size-5 place-items-center rounded-full text-black shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none',
            autoplay ? 'translate-x-4 bg-white' : '-translate-x-0.5 bg-white/85'
          )}>
          {autoplay ? (
            <PlayIcon className='size-3 fill-current' />
          ) : (
            <PauseIcon className='size-3 fill-current' />
          )}
        </span>
      </span>
    </button>
  )
}

// Theater (on a wide watch page) and Fullscreen: the ways the player can take more of the screen
const ViewButtons = ({
  fullscreen,
  onToggleFullscreen,
  theater,
  onToggleTheater,
}: Pick<
  StageControlsProps,
  'fullscreen' | 'onToggleFullscreen' | 'theater' | 'onToggleTheater'
>) => (
  <>
    {onToggleTheater !== undefined && !fullscreen && (
      <IconButton
        label={theater ? 'Default View' : 'Theater Mode'}
        active={theater}
        onClick={onToggleTheater}>
        <RectangleHorizontalIcon className='size-5' />
      </IconButton>
    )}
    <IconButton
      label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      onClick={onToggleFullscreen}>
      {fullscreen ? (
        <MinimizeIcon className='size-5' />
      ) : (
        <MaximizeIcon className='size-5' />
      )}
    </IconButton>
  </>
)

// What only the full-screen player has; on the watch page the video is a box among the page's own controls,
// which a lock could not cover and turning the page would not help, so arriving there unlocks.
// - A shade over the top (the control bar's, mirrored) while the floating UI shows: the top bar's white logo
//   and icons lie over the video, and a bright one swallows them.
// - The settings for the whole sitting rather than the song, kept out of the thumb's way: a column down the
//   right edge, touch screens only, sliding out to the right with the rest of the UI. Upright it hangs under
//   the top bar's last icon, centred on it; on a phone on its side it mirrors the rail on the left (same
//   buttons, padding and top), so the two frame the video
const FullScreenChrome = ({
  visible,
  locked,
  onLockedChange,
}: Pick<StageControlsProps, 'visible' | 'locked' | 'onLockedChange'>) => {
  const armed = useArmed(visible)
  const landscape = useLandscapeLock()
  const watch = useAtomValue(playerSurfaceAtom) === 'watch'
  useEffect(() => {
    if (watch && locked) {
      onLockedChange(false)
    }
  }, [watch, locked, onLockedChange])
  if (watch) {
    return null
  }
  return (
    <>
      <div
        aria-hidden='true'
        style={FADE_VARS}
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 z-30 h-[calc(var(--topbar-h)+3rem)] bg-linear-to-b from-black/60 to-transparent transition-opacity duration-(--controls-fade)',
          visible ? 'opacity-100' : 'opacity-0'
        )}
      />
      <div
        data-player-chrome
        className={cn(
          'hidden absolute top-(--stage-corner-top) right-[calc(var(--safe-right)+0.625rem)] z-30 flex-col items-center gap-1 rounded-full bg-black/55 p-1 shadow-rail backdrop-blur-md transition-translate-fade duration-300 ease-out sm:right-[calc(var(--safe-right)+1.125rem)] touch:flex',
          // On its side, on the control bar's right-hand axis: the bar's 44px buttons sit inside its
          // max(1rem, safe area) padding, this 40px column 2px further in
          'short:top-[calc(var(--topbar-h)+0.25rem)] short:right-[calc(var(--spacing-controls-right)+2px)] short:rounded-xl',
          visible
            ? 'translate-x-0'
            : 'translate-x-[calc(100%+var(--spacing-controls-right)+1.125rem)]',
          !armed && 'pointer-events-none'
        )}>
        <IconButton
          label='Lock Landscape'
          active={landscape.locked}
          onClick={() => {
            void landscape.toggle()
          }}
          className='rounded-full short:size-8 short:rounded-lg'>
          <SmartphoneIcon className='size-5 rotate-90' />
        </IconButton>
        <IconButton
          label='Lock Screen'
          onClick={() => {
            onLockedChange(true)
          }}
          className='rounded-full short:size-8 short:rounded-lg'>
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
    </>
  )
}

export const StageControls = ({
  player,
  visible,
  loop,
  onLoopChange,
  fullscreen,
  onToggleFullscreen,
  theater,
  onToggleTheater,
  zoomed,
  onToggleZoom,
  onSeekBy,
  volume,
  onVolumeChange: setVolume,
  locked,
  onLockedChange,
}: StageControlsProps) => {
  const armed = useArmed(visible)
  const barRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observe = (bar: HTMLDivElement, content: HTMLDivElement) => {
      // Published for what floats above the controls: the lyrics, the rail in portrait and notices
      // (see --stage-chrome-h)
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
      <FullScreenChrome
        visible={visible}
        locked={locked}
        onLockedChange={onLockedChange}
      />
      <div
        ref={barRef}
        style={FADE_VARS}
        className={cn(
          'absolute inset-x-0 bottom-0 z-30 bg-linear-to-t from-black/80 via-black/40 to-transparent pt-10 pr-controls-right pb-controls-bottom pl-controls-left transition-opacity duration-(--controls-fade) watch-narrow:pt-6 watch-narrow:pr-2 watch-narrow:pb-1 watch-narrow:pl-2 pills:from-black/60 pills:via-black/20 short:pl-controls-rail',
          visible ? 'opacity-100' : 'opacity-0',
          !armed && 'pointer-events-none'
        )}>
        {/* On a phone on its side the seek bar joins the buttons' row: two rows would cover a third of the
          screen and push the lyrics to its middle. In the small video of a narrow watch page it runs the whole
          width along the bottom, under the buttons, as on YouTube: beside them it was 115px of a 4-minute song */}
        <div
          ref={contentRef}
          data-player-chrome
          className='watch-narrow:flex watch-narrow:flex-wrap watch-narrow:items-center watch-narrow:gap-0.5 short:flex short:items-center short:gap-1'>
          {/* On a touch screen the clock sits at the end of the seek bar, so the buttons' row fits at 320px */}
          <div className='mb-2 flex items-center gap-3 watch-narrow:contents short:contents'>
            <Slider
              look='seek'
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
              className='min-w-0 flex-1 cursor-pointer watch-narrow:order-4 watch-narrow:mx-2 watch-narrow:mb-1 watch-narrow:basis-full short:order-1 short:mx-2'
            />
            <Clock
              time={shown}
              duration={duration}
              className='hidden shrink-0 watch-narrow:order-2 touch:block short:order-2'
            />
          </div>
          <div className='flex items-center gap-1 watch-narrow:contents touch:gap-0.5 pills:gap-2 short:contents'>
            {/* Bottom left, where every player has it, although touch screens also have one mid-stage */}
            <IconButton
              label={isPlaying ? 'Pause' : 'Play'}
              className={cn('watch-narrow:hidden', PILL_GLASS)}
              onClick={() => {
                player.togglePlay()
              }}>
              {isPlaying ? (
                <PauseIcon className='size-5' />
              ) : (
                <PlayIcon className='size-5' />
              )}
            </IconButton>
            <div className={cn('contents', PILL)}>
              <IconButton
                label={`Back ${TAP_SEEK_SEC} Seconds`}
                className='watch-narrow:hidden'
                onClick={() => {
                  onSeekBy(-TAP_SEEK_SEC)
                }}>
                <SeekGlyph direction='back' />
              </IconButton>
              <IconButton
                label={`Forward ${TAP_SEEK_SEC} Seconds`}
                className='watch-narrow:hidden'
                onClick={() => {
                  onSeekBy(TAP_SEEK_SEC)
                }}>
                <SeekGlyph direction='forward' />
              </IconButton>
            </div>
            {/* The slider only opens while the volume button is hovered or focused, so touch screens
              keep just the mute button and the device's own volume */}
            <div
              className={cn('group/volume flex items-center', PILL)}
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
                    look='volume'
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
              className={cn(
                'ml-2 watch-narrow:order-2 watch-narrow:ml-0 watch-narrow:shrink-0 touch:hidden pills:ml-0 pills:h-10 pills:px-4 short:order-2 short:ml-0 short:shrink-0',
                PILL
              )}
            />
            <div
              className={cn(
                'ml-auto flex shrink-0 items-center gap-1 watch-narrow:order-3 touch:gap-0.5 pills:gap-0.5 pills:px-1 short:order-3 short:ml-1',
                PILL
              )}>
              <AutoplaySwitch />
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
                // A 320px phone's bar has no room for it beside Fullscreen; Z still toggles it
                className='max-[359px]:hidden'
                onClick={onToggleZoom}>
                {zoomed ? (
                  <ShrinkIcon className='size-5' />
                ) : (
                  <ExpandIcon className='size-5' />
                )}
              </IconButton>
              <ViewButtons
                fullscreen={fullscreen}
                onToggleFullscreen={onToggleFullscreen}
                theater={theater}
                onToggleTheater={onToggleTheater}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
