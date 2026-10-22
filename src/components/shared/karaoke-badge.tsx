import { MicVocalIcon } from 'lucide-react'

import { useHasKaraoke } from '@/lib/react-query/queries-and-mutations'
import { cn } from '@/utils/cn'

// Marks a song whose lyrics are timed word by word, so the player fills them as they are sung. Every other
// song gets nothing
export const KaraokeBadge = ({ className }: { className?: string }) => (
  <span
    title='Karaoke Lyrics'
    className={cn('inline-flex shrink-0 text-primary-text', className)}>
    <MicVocalIcon aria-hidden className='size-4' />
    <span className='sr-only'>Karaoke Lyrics</span>
  </span>
)

// The same mark on a list row's thumbnail: the picture's edge in the accent and a mic floating on its top-right
// corner, half outside it, so a karaoke song stands out in a list at a glance. Laid over the thumbnail, which
// must not clip it: the thumbnail rounds its own picture instead of hiding its overflow. Rounded as list
// thumbnails are; `small` for the saved menu's 80px ones, which are rounded less
export const KaraokeEdge = ({ small = false }: { small?: boolean }) => (
  <>
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 border-2 border-primary',
        small ? 'rounded-xs' : 'rounded-sm'
      )}
    />
    <span
      aria-hidden
      data-karaoke-badge
      className={cn(
        'pointer-events-none absolute top-0 right-0 grid translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow-sm',
        small ? 'size-4.5' : 'size-5 max-[359px]:size-4.5'
      )}>
      <MicVocalIcon aria-hidden className='size-3' />
    </span>
  </>
)

// The mark before a card's title, centred on its first line: the title and the mic share the box's font and
// line height, and the mic's box is one line tall
export const KaraokeTitleIcon = () => (
  <span
    aria-hidden
    data-karaoke-title-mic
    className='flex h-lh shrink-0 items-center text-primary-text'>
    <MicVocalIcon aria-hidden className='size-4' />
  </span>
)

// What the marks say, for a screen reader, placed after a song's title so the title is read first
export const KaraokeLabel = () => (
  <span className='sr-only'>, Karaoke Lyrics</span>
)

export const KaraokeLabelMark = ({ videoId }: { videoId: string }) =>
  useHasKaraoke(videoId) ? <KaraokeLabel /> : null

export const KaraokeEdgeMark = ({
  videoId,
  small,
}: {
  videoId: string
  small?: boolean
}) => (useHasKaraoke(videoId) ? <KaraokeEdge small={small} /> : null)

export const KaraokeTitleIconMark = ({ videoId }: { videoId: string }) =>
  useHasKaraoke(videoId) ? <KaraokeTitleIcon /> : null

// The badge for a song known only by its id, from the library list
export const KaraokeMark = ({
  videoId,
  className,
}: {
  videoId: string
  className?: string
}) => (useHasKaraoke(videoId) ? <KaraokeBadge className={className} /> : null)
