import { PauseIcon, PlayIcon } from 'lucide-react'

import type { CssVars } from '@/types'
import { formatClock } from '@/utils'

// Spotify's lyrics controls: a scrubbable bar with elapsed and remaining time over one large play button. On a short
// screen (a phone on its side) one row, the times at the bar's ends and a 44px button after them, so the lyrics keep
// the height. Either way the bar comes before the button, as it is read
export const PlaybackBar = ({
  time,
  duration,
  playing,
  onSeek,
  onToggle,
}: {
  time: number
  duration: number
  playing: boolean
  onSeek: (time: number) => void
  onToggle: () => void
}) => {
  const rangeVars: CssVars = {
    '--range-color': 'var(--reader-fg)',
    '--range-fill': `${duration > 0 ? (time / duration) * 100 : 0}%`,
  }
  return (
    <div className='mx-auto grid w-full max-w-xl grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-5 pt-3 pb-2 short:grid-cols-[auto_1fr_auto_auto] short:py-1.5'>
      <input
        type='range'
        aria-label='Song Position'
        aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
        min={0}
        max={duration}
        step={0.1}
        value={time}
        onChange={(event) => {
          onSeek(Number(event.target.value))
        }}
        style={rangeVars}
        className='col-span-3 row-start-1 slim-range w-full short:col-span-1 short:col-start-2'
      />
      <span className='col-start-1 row-start-2 text-xs text-(--reader-muted) tabular-nums short:row-start-1'>
        {formatClock(time)}
      </span>
      <span className='col-start-3 row-start-2 text-right text-xs text-(--reader-muted) tabular-nums short:row-start-1'>
        -{formatClock(duration - time)}
      </span>
      <button
        type='button'
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={onToggle}
        className='col-span-3 row-start-3 mx-auto flex size-14 items-center justify-center rounded-full bg-(--reader-fg) text-(--reader-bg) transition-transform motion-safe:active:scale-96 short:col-span-1 short:col-start-4 short:row-start-1 short:size-11'>
        {playing ? (
          <PauseIcon className='size-6 fill-current short:size-5' />
        ) : (
          <PlayIcon className='ml-0.5 size-6 fill-current short:size-5' />
        )}
      </button>
    </div>
  )
}
