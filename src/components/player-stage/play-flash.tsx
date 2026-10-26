import { PauseIcon, PlayIcon } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { reducedMotion } from '@/lib/reduced-motion'

import type { StagePhase } from './use-you-tube-player'

export interface PlayFlashState {
  // What the press did: the icon that flashes
  icon: 'play' | 'pause'
  // A new press, even to the same icon, flashes again
  key: number
}

// YouTube's own (measured on youtube.com, 2026-10-26): `ytp-delhi-modern-bezel-fadeout`, 1s on
// cubic-bezier(0.05, 0, 0, 1), opacity 0 → 1 while it grows to 1.33×, held from 25% to 75%, then fading out
// as it shrinks back
const FLASH_MS = 1000
const EASE = 'cubic-bezier(0.05, 0, 0, 1)'
// The easing applies to each step between keyframes, as a CSS animation's does (on the whole run it would reach
// full size at ~12% and start fading by ~40%)
const GROW: Keyframe[] = [
  { easing: EASE, opacity: 0, transform: 'scale(1)' },
  { easing: EASE, offset: 0.25, opacity: 1, transform: 'scale(1.33)' },
  { easing: EASE, offset: 0.75, opacity: 1, transform: 'scale(1.33)' },
  { opacity: 0, transform: 'scale(1)' },
]
// Reduced motion: the same rhythm, no growing
const FADE: Keyframe[] = [
  { easing: EASE, opacity: 0 },
  { easing: EASE, offset: 0.25, opacity: 1 },
  { easing: EASE, offset: 0.75, opacity: 1 },
  { opacity: 0 },
]

// The brief play/pause sign in the middle of the video after a press that plays or pauses, as YouTube's player
// shows it: where a mouse plays (a finger has the middle play button). Opacity and transform only, so it runs on
// the compositor; it never takes presses
export const PlayFlash = ({ flash }: { flash: PlayFlashState | null }) => {
  const disc = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = disc.current
    const animation =
      element === null || flash === null
        ? null
        : element.animate(reducedMotion() ? FADE : GROW, {
            duration: FLASH_MS,
            fill: 'forwards',
          })
    return () => {
      animation?.cancel()
    }
  }, [flash])
  if (flash === null) {
    return null
  }
  const Icon = flash.icon === 'play' ? PlayIcon : PauseIcon
  return (
    <div
      ref={disc}
      aria-hidden
      data-play-flash={flash.icon}
      className='hidden pointer-events-none absolute top-(--video-cy) left-1/2 z-26 -mt-[39px] -ml-[39px] size-[78px] place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-lg mouse:grid'>
      <Icon
        className={
          flash.icon === 'play'
            ? 'size-10 translate-x-0.5 fill-current'
            : 'size-10 fill-current'
        }
      />
    </div>
  )
}

// The stage's play/pause, flashing what each press did: pause while playing (or buffering, which togglePlay also
// pauses), play otherwise
export const usePlayFlash = (phase: StagePhase, toggle: () => void) => {
  const [flash, setFlash] = useState<PlayFlashState | null>(null)
  const playing = useRef(false)
  useLayoutEffect(() => {
    playing.current = phase.kind === 'playing' || phase.kind === 'buffering'
  })
  const togglePlay = useCallback(() => {
    const icon = playing.current ? 'pause' : 'play'
    setFlash((last) => ({ icon, key: (last?.key ?? 0) + 1 }))
    toggle()
  }, [toggle])
  return { flash, togglePlay }
}
