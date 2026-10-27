import { useAtom, useAtomValue } from 'jotai'
import {
  ChevronDownIcon,
  ExpandIcon,
  LockIcon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RepeatIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ShrinkIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SmartphoneIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'

import { STAGE_DISC } from '@/components/lyrics-display/rail-button'
import { TheaterIcon } from '@/components/svgicons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import { minimisePlayer } from '@/components/watch/use-drag-to-minimise'
import { playbackRateAtom, playerSurfaceAtom } from '@/context/atoms'
import { useArmed } from '@/hooks/use-armed'
import { useLandscapeLock } from '@/hooks/use-landscape-lock'
import { autoplayAtom } from '@/lib/listening/store'
import { useMenuOffset } from '@/lib/menu-offset'
import type { CssVars } from '@/types'
import { formatClock } from '@/utils'
import { cn } from '@/utils/cn'

import { ariaKeys, SHORTCUTS } from './shortcuts'
import type { PlayerAction } from './shortcuts'
import { StageLock } from './stage-lock'
import { TAP_SEEK_SEC } from './use-stage-taps'
import type { PlayerVolume, StagePlayer } from './use-you-tube-player'
import { engineRates, setEngineRate } from './youtube-engine'

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

// Previous, Play and Next leave the bar wherever the middle row has them: a narrow watch page, and full screen on
// a touch screen (CenterPlayButton, owner 2026-10-27); the bar keeps -10s and +10s. Space, K and the arrow keys
// still work there (player-stage.tsx › handleKeyDown)
const inCentreRow = (fullscreen: boolean) =>
  fullscreen ? 'watch-narrow:hidden touch:hidden' : 'watch-narrow:hidden'

// Where a button's label sits over it: centred, or flush with the button's outer side at the bar's ends, so it stays
// on the stage
const TIP_CENTRE = 'left-1/2 -translate-x-1/2'
const TIP_START = 'left-0'
const TIP_END = 'right-0'

// The label over a bar button (globals.css › control-tip): its name, then its key where it has one. Hidden from
// assistive technology, which reads the button's own name and aria-keyshortcuts
const ControlTip = ({
  label,
  shortcut,
  place = TIP_CENTRE,
}: {
  label: string
  shortcut?: PlayerAction | PlayerAction[]
  place?: string
}) => {
  const actions = shortcut === undefined ? [] : [shortcut].flat()
  return (
    <span aria-hidden className={cn('control-tip', place)}>
      {label}
      {actions.length > 0 && (
        <span className='flex gap-1'>
          {actions
            .flatMap((action) => SHORTCUTS[action].caps)
            .map((cap) => (
              <kbd key={cap} className='control-key'>
                {cap}
              </kbd>
            ))}
        </span>
      )}
    </span>
  )
}

interface IconButtonProps {
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  className?: string
  shortcut?: PlayerAction
  tipPlace?: string
  children: React.ReactNode
}

const IconButton = ({
  label,
  onClick,
  active,
  disabled,
  className,
  shortcut,
  tipPlace,
  children,
}: IconButtonProps) => (
  <button
    type='button'
    aria-label={label}
    aria-keyshortcuts={shortcut === undefined ? undefined : ariaKeys(shortcut)}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'relative grid size-9 shrink-0 place-items-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:text-white/35 disabled:hover:bg-transparent touch:size-11 touch:watch-narrow:size-10 pills:size-10 pills:rounded-full',
      active === true && 'text-primary-text hover:text-primary-text',
      className
    )}>
    {children}
    <ControlTip label={label} shortcut={shortcut} place={tipPlace} />
  </button>
)

// YouTube's own speeds, for a player that hasn't said which the video allows yet
const YOUTUBE_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const speedName = (rate: number) => (rate === 1 ? 'Normal' : `${rate}×`)
const allowedSpeeds = () => {
  const reported = engineRates()
  return reported.length > 0 ? reported : YOUTUBE_SPEEDS
}

// The speed one step slower or faster than `rate` among those the video allows (the < and > keys); the same at
// either end
export const stepSpeed = (rate: number, direction: -1 | 1): number => {
  const speeds = allowedSpeeds()
  const next =
    direction === 1
      ? speeds.find((speed) => speed > rate)
      : speeds.findLast((speed) => speed < rate)
  return next ?? rate
}

// The speed as plain text on the bar's glass, as video players show it now ("1×", "0.75×"): the label is the control.
// As tall as the icon buttons beside it, one width for every speed ("0.75×" the widest), so choosing one never moves
// the buttons beside it
const SPEED_IN_BAR =
  'grid h-9 w-12 shrink-0 place-items-center rounded-md text-sm leading-none font-semibold whitespace-nowrap text-white/85 tabular-nums transition-colors hover:bg-white/10 hover:text-white touch:h-11 touch:watch-narrow:h-10 pills:h-10 pills:rounded-full'
// In the right-hand column: the discs' glass and height, stretched into a pill so "0.75×" fits. The column is as wide
// as a disc (FullScreenChrome), and a wider pill keeps the discs' right edge and grows to the left, so the discs stay
// on its axis and the pill stays out of the right-hand safe area
const SPEED_IN_COLUMN =
  'grid h-10 min-w-10 shrink-0 self-end place-items-center rounded-full bg-black/55 px-2 text-sm leading-none font-semibold whitespace-nowrap text-white/90 tabular-nums shadow-rail backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white touch:h-11 touch:min-w-11 short:h-9 short:min-w-9'

// Every speed the video allows, in a menu, the current one checked; a choice applies it and closes the menu. In the
// bar the menu opens above its button; in the right-hand column, to its left. Its open menu holds the controls up
// (use-idle.ts › chromeBusy)
const SpeedMenu = ({
  side,
  className,
}: {
  side: 'top' | 'left'
  className: string
}) => {
  const [rate, setRate] = useAtom(playbackRateAtom)
  const { measure, offset, triggerRef } = useMenuOffset<HTMLButtonElement>(side)
  const speeds = allowedSpeeds()
  if (speeds.length < 2) {
    return null
  }
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) {
          measure()
        }
      }}>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type='button'
          aria-label={`Playback Speed ${rate}×`}
          aria-keyshortcuts={`${ariaKeys('slower')} ${ariaKeys('faster')}`}
          className={cn('relative', className)}>
          {/* One grid item, so the sign stays on the digits' line. Its ink centres 0.1em under theirs (Plus Jakarta Sans:
              3.8 vs 5.2px above the baseline at 14px). The label is out of the grid's flow (absolute) */}
          <span>
            {rate}
            <span className='relative -top-[0.1em]'>×</span>
          </span>
          {side === 'top' && (
            <ControlTip
              label='Playback Speed'
              shortcut={['slower', 'faster']}
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={side === 'top' ? 'end' : 'center'}
        sideOffset={offset}
        collisionPadding={8}>
        <DropdownMenuRadioGroup
          value={String(rate)}
          onValueChange={(value) => {
            const next = Number(value)
            setRate(next)
            setEngineRate(next)
          }}>
          {speeds.map((speed) => (
            <DropdownMenuRadioItem key={speed} value={String(speed)}>
              {speedName(speed)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
  onPrevious: () => void
  // Undefined while there is no song to go on to
  onNext?: () => void
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
    data-press
    className={cn(
      'min-w-0 truncate text-sm whitespace-nowrap text-white tabular-nums',
      className
    )}>
    {formatClock(time)} / {formatClock(duration)}
  </span>
)

export const CONTROLS_FADE_MS = 300
const FADE_VARS: CssVars = { '--controls-fade': `${CONTROLS_FADE_MS}ms` }
const OBSTRUCTION_GAP_PX = 8
// With a mouse the bar takes presses only on its controls and the glass they sit on (`data-press`): its top padding
// and the gaps between its groups pass them on to lyrics dragged down under the bar. The stage itself ignores a
// press on the bar (use-stage-taps.ts › onControlBar), so a gap never plays or pauses. A touch screen keeps the
// whole bar, so a finger that just misses a button doesn't hide the controls
const PRESS_THROUGH = 'mouse:pointer-events-none'
const PRESSABLE = 'mouse:[&_:is(button,[data-press])]:pointer-events-auto'
// ...except in a narrow watch page's small video, where the gradient above the rows reaches the middle row of
// Previous, Play and Next (center-play-button.tsx): there only the rows keep a finger's near misses
const NARROW_ROWS_ONLY =
  'touch:watch-narrow:pointer-events-none touch:watch-narrow:[&>[data-player-chrome]]:pointer-events-auto'
const VOLUME_WHEEL_STEP = 0.05
// The clock counts a seek as landed within this of its target
const SEEK_SETTLED_SEC = 1
const SEEK_HOLD_MAX_MS = 3000

// The playing time and the seek bar's held value, kept here and read only by the bar and the clocks: the clock moves
// every quarter second, and kept in StageControls it re-rendered every button of the controls with it
interface PlaybackTime {
  shown: number
  duration: number
  hold: (value: number | null) => void
  commit: (value: number) => void
}
const PlaybackTimeContext = createContext<PlaybackTime | null>(null)

const usePlaybackTime = () => {
  const time = use(PlaybackTimeContext)
  if (time === null) {
    throw new Error('Inside PlaybackTimeProvider only')
  }
  return time
}

const PlaybackTimeProvider = ({
  player,
  children,
}: {
  player: StagePlayer
  children: ReactNode
}) => {
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
  const commit = useCallback(
    (target: number) => {
      player.seek(target)
      setHeld({ committed: true, value: target })
      // A seek the player never reports lets go of the bar anyway
      clearTimeout(releaseRef.current)
      releaseRef.current = setTimeout(() => {
        setHeld(null)
      }, SEEK_HOLD_MAX_MS)
    },
    [player]
  )
  const hold = useCallback((target: number | null) => {
    setHeld(target === null ? null : { committed: false, value: target })
  }, [])
  const shown = held?.value ?? time
  const value = useMemo<PlaybackTime>(
    () => ({ commit, duration, hold, shown }),
    [commit, duration, hold, shown]
  )
  return <PlaybackTimeContext value={value}>{children}</PlaybackTimeContext>
}

const SeekSlider = ({ className }: { className: string }) => {
  const { shown, duration, hold, commit } = usePlaybackTime()
  return (
    <Slider
      data-press
      look='seek'
      aria-label='Seek'
      hoverLabel={formatClock}
      valueText={(value) => `${formatClock(value)} of ${formatClock(duration)}`}
      min={0}
      max={Math.max(duration, 1)}
      step={0.1}
      value={[shown]}
      onValueChange={([value]) => {
        hold(value ?? null)
      }}
      onValueCommit={([value]) => {
        if (value === undefined) {
          hold(null)
          return
        }
        commit(value)
      }}
      className={className}
    />
  )
}

const LiveClock = ({ className }: { className: string }) => {
  const { shown, duration } = usePlaybackTime()
  return <Clock time={shown} duration={duration} className={className} />
}

// Escape puts the bar's labels away (WCAG 1.4.13: dismissed without moving the pointer or focus) until the pointer or
// focus reaches another button
const useTipsDismiss = () => {
  const [tipsOff, setTipsOff] = useState(false)
  const shownFor = useRef<Element | null>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTipsOff(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  const tipsOn = (target: EventTarget) => {
    const button = target instanceof Element ? target.closest('button') : null
    if (button !== shownFor.current) {
      shownFor.current = button
      setTipsOff(false)
    }
  }
  return { tipsOff, tipsOn }
}

// One of the control bar's pills: a light glass behind a group of buttons, on a wide screen with a mouse. Over the
// bar's shade a dark pill vanished; a light one reads over dark and bright video alike. No backdrop blur: under the
// bar's fading opacity a blurred backdrop doesn't fade with the rest, and the pills hung on after their icons
const PILL_GLASS = 'pills:rounded-full pills:bg-white/12'
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
      onClick={() => {
        setAutoplay(!autoplay)
      }}
      className='hidden relative h-10 w-13 shrink-0 place-items-center rounded-full pills:grid'>
      <ControlTip label={autoplay ? 'Autoplay Is On' : 'Autoplay Is Off'} />
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
        shortcut='theater'
        active={theater}
        onClick={onToggleTheater}>
        <TheaterIcon aria-hidden theater={theater} className='size-5' />
      </IconButton>
    )}
    <IconButton
      label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      shortcut='fullscreen'
      // The bar's last button: its label ends at the button's right edge, on the stage
      tipPlace={TIP_END}
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
          // Not on a phone on its side, where the lyrics run up to the top: the shade dimmed their top lines whenever the
          // controls showed. There the bar's buttons carry their own shadow (globals.css › player-topbar-shadow)
          'pointer-events-none absolute inset-x-0 top-0 z-30 h-[calc(var(--topbar-h)+3rem)] bg-linear-to-b from-black/60 to-transparent transition-opacity duration-(--controls-fade) short:hidden',
          visible ? 'opacity-100' : 'opacity-0'
        )}
      />
      <div
        data-player-chrome
        className={cn(
          'hidden absolute top-(--stage-corner-top) right-[calc(var(--safe-right)+0.125rem)] z-30 w-14 flex-col items-center gap-2 p-2 transition-translate-fade duration-300 ease-out sm:right-[calc(var(--safe-right)+0.625rem)] touch:flex touch:w-15 short:w-13',
          // On its side, vertically centred, mirroring the rail on the left, on the control bar's right-hand
          // axis: the bar's 44px buttons sit inside its max(1rem, safe area) padding, these 36px discs 4px
          // further in
          'short:top-1/2 short:right-[calc(var(--spacing-controls-right)-0.25rem)] short:-translate-y-1/2 short:gap-1.5',
          visible
            ? 'translate-x-0'
            : 'translate-x-[calc(100%+var(--spacing-controls-right)+1.125rem)] motion-reduce:translate-x-0 motion-reduce:opacity-0',
          !armed && 'pointer-events-none'
        )}>
        <SpeedMenu side='left' className={SPEED_IN_COLUMN} />
        <IconButton
          label='Lock Landscape'
          active={landscape.locked}
          onClick={() => {
            void landscape.toggleLock()
          }}
          className={STAGE_DISC}>
          <SmartphoneIcon className='size-5 rotate-90' />
        </IconButton>
        <IconButton
          label='Lock Screen'
          onClick={() => {
            onLockedChange(true)
          }}
          className={STAGE_DISC}>
          <LockIcon className='size-5' />
        </IconButton>
        {/* The system turns a phone held either way only while its rotation lock is off; with it on, the
            page turns one way, and this turns it to the other. On its side it hangs under the column, out of
            its centring, so the turned page's column sits where the rotated one's does (landscape-parity.ts) */}
        {landscape.turned && (
          <IconButton
            label='Flip Screen'
            onClick={() => {
              landscape.flip()
            }}
            className={cn(
              STAGE_DISC,
              'short:absolute short:top-[calc(100%-0.125rem)] short:left-2'
            )}>
            <RefreshCwIcon className='size-5' />
          </IconButton>
        )}
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

// The installed app's player held upright has no top bar (globals.css, as YouTube's): this takes the listener back to
// the tabs the way the drag down does (use-drag-to-minimise.ts › minimisePlayer), from the video's top left. On the
// glass the corner discs use, so it reads over any frame; it comes and goes with the rest of the floating UI
const MinimiseButton = ({ visible }: Pick<StageControlsProps, 'visible'>) => {
  const armed = useArmed(visible)
  const watch = useAtomValue(playerSurfaceAtom) === 'watch'
  if (!watch) {
    return null
  }
  return (
    <button
      type='button'
      data-press
      aria-label='Minimize Player'
      title='Minimize Player'
      onClick={minimisePlayer}
      style={FADE_VARS}
      className={cn(
        STAGE_DISC,
        'hidden absolute top-2 left-2 z-30 transition-opacity duration-(--controls-fade) installed:portrait:watch-narrow:grid',
        visible ? 'opacity-100' : 'opacity-0',
        !armed && 'pointer-events-none'
      )}>
      <ChevronDownIcon className='size-6' aria-hidden />
    </button>
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
  onPrevious,
  onNext,
  volume,
  onVolumeChange: setVolume,
  locked,
  onLockedChange,
}: StageControlsProps) => {
  const armed = useArmed(visible)
  const barRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const { tipsOff, tipsOn } = useTipsDismiss()

  useEffect(() => {
    const observe = (bar: HTMLDivElement, content: HTMLDivElement) => {
      // Published for what floats above the controls: the rail in portrait and notices
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

  const isPlaying =
    player.phase.kind === 'playing' || player.phase.kind === 'buffering'
  // A touch screen's full-screen player has no room in its bar: Playback Speed sits in the column on the right
  // (FullScreenChrome) there
  const watch = useAtomValue(playerSurfaceAtom) === 'watch'

  return (
    <PlaybackTimeProvider player={player}>
      <FullScreenChrome
        visible={visible}
        locked={locked}
        onLockedChange={onLockedChange}
      />
      <MinimiseButton visible={visible} />
      <div
        ref={barRef}
        style={FADE_VARS}
        data-controls-hidden={visible ? undefined : ''}
        data-tips-off={tipsOff ? '' : undefined}
        onPointerOver={(event) => {
          tipsOn(event.target)
        }}
        onFocus={(event) => {
          tipsOn(event.target)
        }}
        className={cn(
          'absolute inset-x-0 bottom-0 z-30 bg-linear-to-t from-black/80 via-black/40 to-transparent pt-10 pr-controls-right pb-controls-bottom pl-controls-left transition-opacity duration-(--controls-fade) watch-narrow:pt-6 watch-narrow:pr-2 watch-narrow:pb-1 watch-narrow:pl-2 pills:from-black/60 pills:via-black/20 short:pl-controls-rail',
          // The buttons' labels clear the seek bar where it runs over them (the seek row's 16px and its 8px margin);
          // where it runs beside or under them, they sit just over the button
          '[--tip-lift:2rem] watch-narrow:[--tip-lift:0.5rem] short:[--tip-lift:0.5rem]',
          // A phone on its side, Lock Landscape's turn included: no shade. Its band ran the stage's whole length behind
          // the buttons and the rail's corner, and read as a haze over the controls (owner, 2026-10-26); the buttons,
          // the seek bar and the clock carry the stage's own shadow instead, as the bar's top icons do (#467)
          'short:bg-none short:[&_[data-press][data-orientation]]:drop-shadow-stage short:[&_svg]:drop-shadow-stage',
          visible ? 'opacity-100' : 'opacity-0',
          PRESS_THROUGH,
          armed ? cn(PRESSABLE, NARROW_ROWS_ONLY) : 'pointer-events-none'
        )}>
        {/* On a phone on its side the seek bar joins the buttons' row: two rows would cover a third of the
          screen and push the lyrics to its middle. In the small video of a narrow watch page it runs the whole
          width along the bottom, under the buttons, as on YouTube: beside them it was 115px of a 4-minute song */}
        <div
          ref={contentRef}
          data-player-chrome
          data-controls-rows
          className='watch-narrow:flex watch-narrow:flex-wrap watch-narrow:items-center watch-narrow:gap-0.5 short:flex short:items-center short:gap-1'>
          {/* On a touch screen the clock sits at the end of the seek bar, so the buttons' row fits at 320px */}
          <div className='mb-2 flex items-center gap-3 watch-narrow:contents short:contents'>
            <SeekSlider className='min-w-0 flex-1 cursor-pointer watch-narrow:order-4 watch-narrow:mx-2 watch-narrow:mb-1 watch-narrow:basis-full short:order-1 short:mx-2' />
            <LiveClock className='hidden shrink-0 watch-narrow:order-2 touch:block short:order-2 short:drop-shadow-stage' />
          </div>
          <div className='flex items-center gap-1 watch-narrow:contents touch:gap-0.5 pills:gap-2 short:contents'>
            {/* Bottom left, where every player has it, between Previous and Next; the small video of a narrow watch
              page has them mid-stage instead (CenterPlayButton) */}
            <div
              data-press
              className={cn('contents watch-narrow:hidden', PILL)}>
              <IconButton
                label='Previous'
                shortcut='previous'
                // The bar's first button: its label starts at the button's left edge, on the stage
                tipPlace={TIP_START}
                className={inCentreRow(fullscreen)}
                onClick={onPrevious}>
                <SkipBackIcon className='size-5 fill-current' />
              </IconButton>
              <IconButton
                label={isPlaying ? 'Pause' : 'Play'}
                shortcut='playPause'
                className={inCentreRow(fullscreen)}
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
                label='Next'
                shortcut='next'
                className={inCentreRow(fullscreen)}
                disabled={onNext === undefined}
                onClick={onNext}>
                <SkipForwardIcon className='size-5 fill-current' />
              </IconButton>
            </div>
            <div data-press className={cn('contents', PILL)}>
              <IconButton
                label={`Back ${TAP_SEEK_SEC} Seconds`}
                shortcut='back'
                className='watch-narrow:hidden'
                onClick={() => {
                  onSeekBy(-TAP_SEEK_SEC)
                }}>
                <SeekGlyph direction='back' />
              </IconButton>
              <IconButton
                label={`Forward ${TAP_SEEK_SEC} Seconds`}
                shortcut='forward'
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
              data-press
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
                shortcut='mute'
                // First in a narrow watch page's bar
                tipPlace={cn(
                  TIP_CENTRE,
                  'watch-narrow:left-0 watch-narrow:translate-x-0'
                )}
                onClick={() => {
                  setVolume({ ...volume, muted: !volume.muted })
                }}>
                <VolumeGlyph level={volume.level} muted={volume.muted} />
              </IconButton>
              <div className='flex h-9 w-0 items-center overflow-hidden transition-width duration-200 ease-out group-focus-within/volume:w-24 group-hover/volume:w-24 motion-reduce:transition-none touch:hidden'>
                <div className='w-24 shrink-0 px-2.5'>
                  <Slider
                    look='volume'
                    aria-label='Volume'
                    valueText={(value) => `${Math.round(value * 100)}%`}
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
            <LiveClock
              className={cn(
                'ml-2 watch-narrow:order-2 watch-narrow:ml-0 watch-narrow:shrink-0 touch:hidden pills:ml-0 pills:h-10 pills:px-4 short:order-2 short:ml-0 short:shrink-0',
                PILL
              )}
            />
            <div
              data-press
              className={cn(
                'ml-auto flex shrink-0 items-center gap-1 watch-narrow:order-3 touch:gap-0.5 pills:gap-0.5 pills:px-1 short:order-3 short:ml-1',
                PILL
              )}>
              <AutoplaySwitch />
              <SpeedMenu
                side='top'
                className={cn(SPEED_IN_BAR, !watch && 'touch:hidden')}
              />
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
                shortcut='zoom'
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
    </PlaybackTimeProvider>
  )
}
