import { useAtom, useSetAtom } from 'jotai'
import {
  LoaderIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  VolumeXIcon,
} from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import {
  playerChromeOpenAtom,
  playerVolumeAtom,
  stageClockAtom,
  stageFullscreenAtom,
} from '@/context/atoms'
import { useThemeColor } from '@/hooks/use-theme-color'
import { useWakeLock } from '@/hooks/use-wake-lock'
import { transitionLayout } from '@/lib/view-transition'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import { CenterPlayButton } from './center-play-button'
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
import type { VideoFit } from './video-fit'
import { useVideoAspect, useVideoFit } from './video-fit'
import type { YouTubeQuirks } from './youtube-quirks'

const IDLE_MS = 1800
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

// Calls `handler` inside the next trusted click or key press anywhere, while the browser still counts it
const onNextPress = (handler: () => void) => {
  const types = ['click', 'keydown'] as const
  const listener = (event: Event) => {
    if (event.isTrusted) {
      handler()
    }
  }
  for (const type of types) {
    window.addEventListener(type, listener, { capture: true })
  }
  return () => {
    for (const type of types) {
      window.removeEventListener(type, listener, { capture: true })
    }
  }
}

// The video's box: whole inside the stage, or covering it
const BOX_WIDTH: Record<VideoFit, string> = {
  fit: 'w-[min(100cqw,calc(var(--video-aspect)*100cqh))]',
  zoom: 'w-[max(100cqw,calc(var(--video-aspect)*100cqh))]',
}
// Upright, the lyrics get the space under a whole video, and lie over one that covers the stage
const LYRICS_TOP: Record<VideoFit, string> = {
  fit: 'portrait:top-[calc(var(--video-cy)+min(50cqw/var(--video-aspect),50cqh)+0.5rem)]',
  zoom: '',
}

// What sits outside the stage reads from it: the song's clock (the watch page's lyrics), and whether it is the
// whole screen now (fullscreen, or iPhone's stand-in), which turns the watch page back into the stage alone
const usePublishStage = (
  { getTime, seek, pause, subscribeFrame, phase }: StagePlayer,
  fullscreen: boolean,
  immersive: boolean,
  onEnded: (() => void) | undefined
) => {
  // The song played to its end (not looping): the page decides what plays next
  const onEndedRef = useRef(onEnded)
  useLayoutEffect(() => {
    onEndedRef.current = onEnded
  })
  const ended = phase.kind === 'ended'
  useEffect(() => {
    if (ended) {
      onEndedRef.current?.()
    }
  }, [ended])
  const setClock = useSetAtom(stageClockAtom)
  useEffect(() => {
    setClock({ getTime, pause, seek, subscribeFrame })
    return () => {
      setClock(null)
    }
  }, [getTime, pause, seek, subscribeFrame, setClock])
  const setStageFullscreen = useSetAtom(stageFullscreenAtom)
  const full = fullscreen || immersive
  useEffect(() => {
    setStageFullscreen(full)
  }, [full, setStageFullscreen])
  useEffect(
    () => () => {
      setStageFullscreen(false)
    },
    [setStageFullscreen]
  )
}

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
const chromeBusy = ({ hover = true } = {}) => {
  const canHover = matchMedia('(hover: hover)').matches
  return [...document.querySelectorAll('[data-player-chrome]')].some(
    (element) =>
      // aria-expanded rather than data-state, which a tooltip on the same trigger overwrites
      element.querySelector('[aria-expanded=true]') !== null ||
      (canHover &&
        ((hover && element.matches(':hover')) ||
          element.querySelector(':focus-visible') !== null))
  )
}

// Idle `ms` after the last pointer or key input, and not while the UI is busy. Any pointer in the window
// counts while the stage is the whole screen; on the watch page only one over the video does, so scrolling
// the page under it doesn't bring up its controls. A mouse leaving the player (the stage on the watch page,
// the window when the stage is the whole screen) idles it at once and marks it `outside`, as on YouTube: the
// controls fade the moment the mouse goes, playing or paused, unless one of their menus or keyboard focus
// holds them, or the mouse went onto the floating UI that lies outside the stage (the top bar)
const useIdle = (ms: number, stageRef: RefObject<HTMLElement | null>) => {
  const [idle, setIdle] = useState(false)
  const [outside, setOutside] = useState(false)
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
    const wakeFromPointer = (event: PointerEvent) => {
      const stage = stageRef.current
      if (
        !('watch' in document.documentElement.dataset) ||
        (stage !== null &&
          event.target instanceof Node &&
          stage.contains(event.target))
      ) {
        setOutside(false)
        wake()
      }
    }
    const leave = (event: PointerEvent) => {
      const onto = event.relatedTarget
      if (
        event.pointerType !== 'mouse' ||
        (onto instanceof Element && onto.closest('[data-player-chrome]'))
      ) {
        return
      }
      setOutside(true)
      if (!chromeBusy({ hover: false })) {
        clearTimeout(timerRef.current)
        setIdle(true)
      }
    }
    const stage = stageRef.current
    const leaveStage = (event: PointerEvent) => {
      if ('watch' in document.documentElement.dataset) {
        leave(event)
      }
    }
    const leaveWindow = (event: PointerEvent) => {
      if (!('watch' in document.documentElement.dataset)) {
        leave(event)
      }
    }
    window.addEventListener('pointermove', wakeFromPointer)
    window.addEventListener('pointerdown', wakeFromPointer)
    window.addEventListener('keydown', wake)
    stage?.addEventListener('pointerleave', leaveStage)
    document.documentElement.addEventListener('pointerleave', leaveWindow)
    return () => {
      clearTimeout(timerRef.current)
      window.removeEventListener('pointermove', wakeFromPointer)
      window.removeEventListener('pointerdown', wakeFromPointer)
      window.removeEventListener('keydown', wake)
      stage?.removeEventListener('pointerleave', leaveStage)
      document.documentElement.removeEventListener('pointerleave', leaveWindow)
    }
  }, [wake, stageRef])
  return { idle, outside, sleep, wake }
}

// The floating UI shows after input until idle, never while locked or dragging. Paused, it stays while the
// mouse is over the player and goes with it
const showsControls = (state: {
  locked: boolean
  dragging: boolean
  idle: boolean
  outside: boolean
  playing: boolean
}) =>
  !state.locked &&
  !state.dragging &&
  (!state.idle || (!state.playing && !state.outside))

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

const INTERACTIVE =
  'button, a, [role=switch], [role=tab], [role=menuitem], [role=option], [data-grip]'

// Whether a key press is the player's. Not one a menu or a control already took, nor Space or Enter on a
// focused control (they press it). On the watch page only presses on the page itself or inside the stage
// count: the arrows reorder a queue or move through a menu there, not the volume or the song
const playerOwnsKey = (event: KeyboardEvent) => {
  if (
    event.defaultPrevented ||
    isEditable(event.target) ||
    event.metaKey ||
    event.ctrlKey
  ) {
    return false
  }
  const target = event.target instanceof Element ? event.target : null
  if (target === null || target === document.body) {
    return true
  }
  if (
    (event.key === ' ' || event.key === 'Enter') &&
    target.closest(INTERACTIVE) !== null
  ) {
    return false
  }
  if (document.documentElement.dataset.watch !== undefined) {
    return target.closest('[data-player-stage]') !== null
  }
  return target.closest('[role=menu], [role=dialog], [data-grip]') === null
}

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
  // A finger's tap on the lyrics, passed on to the stage as if it had landed on the video: pressStage as it
  // lands, tapStage when it lifts without a drag
  // `across`: how far across the stage it landed, 0 to 1
  pressStage: (pointerType: string, across: number) => void
  tapStage: () => void
}

interface PlayerStageProps {
  videoId: string
  quirks: YouTubeQuirks
  renderLyrics?: (player: StagePlayer, layout: StageLayout) => ReactNode
  // Start playing once this turns true (e.g. when the lyrics have loaded)
  autoplay?: boolean
  onEvent?: (message: string) => void
  className?: string
  // Theater on the watch page: the control bar's toggle and the T key, where the page offers it
  theater?: boolean
  onToggleTheater?: () => void
  // The song played to its end
  onEnded?: () => void
  // The song before this one, and the one after; undefined where there is none
  onPrevious?: () => void
  onNext?: () => void
}

// Previous restarts a song past its first seconds, as every player does; only near its start does it go back a
// song (or, with none to go back to, restart it)
const RESTART_AFTER_SEC = 3

export const PlayerStage = ({
  videoId,
  quirks,
  renderLyrics,
  autoplay = false,
  onEvent,
  className,
  theater = false,
  onToggleTheater,
  onEnded,
  onPrevious,
  onNext,
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
    onBlocked: () => {
      setAutoplayMuted(true)
    },
    onEvent,
    quirks,
    videoId,
    volume,
  })
  const { phase, stageRef, boxRef } = player

  const aspect = useVideoAspect(videoId)
  const { fit, toggleFit } = useVideoFit()

  const autoplayedRef = useRef(false)
  const { play, unlockSound } = player
  const isReady = phase.kind === 'ready'
  useEffect(() => {
    if (!(autoplay && isReady) || autoplayedRef.current) {
      return
    }
    autoplayedRef.current = true
    play()
  }, [autoplay, isReady, play])

  // While the song is muted only because the browser refused sound, the next tap or key anywhere turns it
  // on: that press is the permission the browser waits for, and it lasts the visit (see youtube-engine)
  useEffect(
    () =>
      autoplayMuted
        ? onNextPress(() => {
            unlockSound()
            setAutoplayMuted(false)
          })
        : undefined,
    [autoplayMuted, unlockSound]
  )

  const { idle, outside, sleep, wake } = useIdle(IDLE_MS, stageRef)
  // A song that starts playing shows its controls for the idle time, wherever the mouse is, as on YouTube:
  // the time it took to load doesn't count
  const lastPhase = useRef(phase.kind)
  // Before paint, so the controls never blink off as playback starts
  useLayoutEffect(() => {
    if (phase.kind === 'playing' && lastPhase.current === 'starting') {
      wake()
    }
    lastPhase.current = phase.kind
  }, [phase.kind, wake])
  const [dragging, setDragging] = useState(false)
  const [locked, setLocked] = useState(false)
  useWakeLock(phase.kind === 'playing' || phase.kind === 'buffering')
  useThemeColor(stageRef)

  // YouTube's own error screens (unavailable, sign-in, age gate) need its UI
  const handsOff = phase.kind === 'error'
  const showCover = !handsOff && coversPhase(phase)
  // Paused, the controls stay while the mouse is over the player, and go with it
  const controlsVisible = showsControls({
    dragging,
    idle,
    locked,
    outside,
    playing: phase.kind === 'playing',
  })
  const blockInput = quirks.blockIframeInput && !handsOff
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
  // The whole page goes fullscreen, not just the stage, so the rail and the controls stay in reach.
  // The player turns with the phone either way round, unless Lock Landscape holds it on its side
  const toggleFullscreen = () => {
    if (!document.fullscreenEnabled) {
      transitionLayout('zoom', () => {
        setImmersive(!immersive)
      })
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
  const previous = () => {
    if (onPrevious === undefined || player.getTime() > RESTART_AFTER_SEC) {
      player.seek(0)
    } else {
      onPrevious()
    }
  }
  const taps = useStageTaps({
    controlsVisible,
    hideControls: sleep,
    seekBy,
    showCover,
    toggleFullscreen,
    togglePlay: player.togglePlay,
  })
  const layout: StageLayout = {
    controlsVisible,
    onDragChange: (next) => {
      setDragging(next)
      // After a drop, keep the controls away until the pointer moves again
      if (!next) {
        sleep()
      }
    },
    pressStage: taps.press,
    tapStage: taps.forward,
  }

  // Before paint, so the zoom's view transition snapshots the full-screen layout
  useLayoutEffect(() => (immersive ? markImmersive() : undefined), [immersive])

  usePublishStage(player, fullscreen, immersive, onEnded)

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

  // One listener for the stage's life, calling the latest handler: a press that shows the controls renders
  // the stage while the press is still being dispatched, and a listener swapped then would miss it
  const keyDownRef = useRef<((event: KeyboardEvent) => void) | null>(null)
  useLayoutEffect(() => {
    keyDownRef.current = (event: KeyboardEvent) => {
      if (!playerOwnsKey(event)) {
        return
      }
      const onSlider =
        event.target instanceof HTMLElement &&
        event.target.getAttribute('role') === 'slider'
      const simple: Partial<Record<string, () => void>> = {
        ' ': player.togglePlay,
        f: toggleFullscreen,
        k: player.togglePlay,
        t: onToggleTheater,
        z: toggleFit,
      }
      const action = simple[event.key]
      if (action !== undefined) {
        action()
        event.preventDefault()
        return
      }
      switch (event.key) {
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
  })
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      keyDownRef.current?.(event)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const stageVars: CssVars = { '--video-aspect': String(aspect) }
  return (
    <div
      ref={stageRef}
      data-player-stage
      data-phase={phase.kind}
      data-fit={fit}
      style={stageVars}
      className={cn(
        // --video-cy is the video's vertical centre: the middle of the stage, in portrait too, with the lyrics
        // in the space below it. The video and the black around it are youtube-engine's layer, under the stage
        '[container-type:size] relative size-full overflow-hidden [--video-cy:50cqh]',
        !controlsVisible && 'cursor-none',
        className
      )}>
      {/* The video's box, in the video's own shape: whole inside the stage, or filling it and cropped. The
          engine lays the video over it */}
      <div
        ref={boxRef}
        className={cn(
          'absolute top-(--video-cy) left-1/2 aspect-(--video-aspect) -translate-1/2 overflow-hidden',
          BOX_WIDTH[fit]
        )}>
        {showCover && <StageCover videoId={videoId} phase={phase} />}
      </div>

      {/* The play/pause control shows and hides with the rest of the floating UI, and on a phone stays as long
          as YouTube's own button under it. It sits outside the video box so it draws above the lyrics */}
      {!showCover && !handsOff && (
        <CenterPlayButton
          phase={phase}
          controlsVisible={controlsVisible}
          onToggle={() => {
            player.togglePlay()
          }}
          onPrevious={previous}
          onNext={onNext}
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
          data-unmute-pill
          onClick={() => {
            setVolume({ ...storedVolume, muted: false })
          }}
          className='absolute top-[calc(var(--topbar-h)+0.5rem+var(--notices-h,0px)+var(--preview-banner-h,0px))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-black/60 px-5 py-2.5 text-base font-medium whitespace-nowrap text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/80'>
          <VolumeXIcon className='size-5' aria-hidden='true' />
          Tap to Unmute
        </button>
      )}

      {renderLyrics && (
        // In portrait the lyrics get the space under a whole video, and lie over one that fills the stage; on a
        // phone on its side they keep clear of the rail's column and the notch. The floating UI at the bottom
        // is cleared by DraggableLyrics' lift
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-25 short:inset-x-controls-rail',
            LYRICS_TOP[fit]
          )}>
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
        theater={theater}
        onToggleTheater={onToggleTheater}
        zoomed={fit === 'zoom'}
        onToggleZoom={toggleFit}
        onSeekBy={seekBy}
        onPrevious={previous}
        onNext={onNext}
        volume={volume}
        onVolumeChange={setVolume}
        locked={locked}
        onLockedChange={setLocked}
      />
    </div>
  )
}
