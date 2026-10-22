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

// The same mark on a list row's thumbnail: the bare mic in the picture's bottom-left corner, a few pixels in, with a
// dark halo so it reads on any picture. `small` for the saved menu's 80px thumbnails. The thumbnail must be positioned
export const KaraokeThumbBadge = ({ small = false }: { small?: boolean }) => (
  <MicVocalIcon
    aria-hidden
    data-karaoke-badge
    strokeWidth={2.5}
    className={cn(
      'pointer-events-none absolute text-primary-text drop-shadow-sm drop-shadow-black/90',
      small ? 'bottom-1 left-1 size-3' : 'bottom-1.5 left-1.5 size-4'
    )}
  />
)

// The mark on a card's picture: a small dark pill in its bottom-left corner, as YouTube marks a video's length or
// LIVE, saying Karaoke in words so a first-time visitor reads it. Nothing in the text below moves for it. The
// picture must be positioned (it is, to hold its play button)
export const KaraokePictureBadge = () => (
  <span
    aria-hidden
    data-karaoke-picture-badge
    className='pointer-events-none absolute bottom-2 left-2 flex h-6 items-center gap-1 rounded-full bg-black/70 ps-1.5 pe-2 text-xs font-semibold text-white'>
    <MicVocalIcon aria-hidden className='size-3.5 text-primary-text' />
    Karaoke
  </span>
)

// What the marks say, for a screen reader, placed after a song's title so the title is read first. Never inside a
// line-clamped title: WebKit counts its hidden text and clips a title that fits with an ellipsis
export const KaraokeLabel = () => (
  <span className='sr-only'>, Karaoke Lyrics</span>
)

export const KaraokeLabelMark = ({ videoId }: { videoId: string }) =>
  useHasKaraoke(videoId) ? <KaraokeLabel /> : null

export const KaraokeThumbBadgeMark = ({
  videoId,
  small,
}: {
  videoId: string
  small?: boolean
}) => (useHasKaraoke(videoId) ? <KaraokeThumbBadge small={small} /> : null)

export const KaraokePictureBadgeMark = ({ videoId }: { videoId: string }) =>
  useHasKaraoke(videoId) ? <KaraokePictureBadge /> : null

// The badge for a song known only by its id, from the library list
export const KaraokeMark = ({
  videoId,
  className,
}: {
  videoId: string
  className?: string
}) => (useHasKaraoke(videoId) ? <KaraokeBadge className={className} /> : null)
