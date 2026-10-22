import { PauseIcon, PlayIcon } from 'lucide-react'

import { formatClock } from '@/utils'

// Spotify's lyrics controls: a scrubbable bar with elapsed and remaining time over one large play button
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
}) => (
  <div className='mx-auto flex w-full max-w-xl flex-col gap-1 px-5 pt-3 pb-2'>
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
      className='h-6 w-full cursor-pointer accent-(--reader-fg)'
    />
    <div className='flex justify-between text-xs text-(--reader-muted) tabular-nums'>
      <span>{formatClock(time)}</span>
      <span>-{formatClock(duration - time)}</span>
    </div>
    <button
      type='button'
      aria-label={playing ? 'Pause' : 'Play'}
      onClick={onToggle}
      className='mx-auto flex size-14 items-center justify-center rounded-full bg-(--reader-fg) text-(--reader-bg) transition-transform active:scale-95'>
      {playing ? (
        <PauseIcon className='size-6 fill-current' />
      ) : (
        <PlayIcon className='ml-0.5 size-6 fill-current' />
      )}
    </button>
  </div>
)
