import { MicVocalIcon } from 'lucide-react'

import { useHasKaraoke } from '@/lib/react-query/queries-and-mutations'
import type { CssVars } from '@/types'
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

// The mic's box, and how far the traced corner runs along each edge
const EDGE: CssVars = { '--mic': '1rem', '--reach': '1.5rem' }
const SMALL_EDGE: CssVars = { '--mic': '0.75rem', '--reach': '1rem' }

// The same mark on a list row's thumbnail: the thumbnail's own top-right corner traced in the accent, along
// the top edge, round the curve and down the right edge, fading out both ways, with the mic just outside the
// corner, its handle on the curve. The trace takes the thumbnail's radius (border-radius: inherit), so it follows the curve exactly.
// Laid over the thumbnail, which must not clip it: the thumbnail rounds its own picture instead of hiding
// its overflow. `small` for the saved menu's 80px thumbnails
export const KaraokeEdge = ({ small = false }: { small?: boolean }) => (
  <span
    aria-hidden
    data-karaoke-badge
    style={small ? SMALL_EDGE : EDGE}
    className='pointer-events-none absolute inset-0 rounded-inherit'>
    <span className='absolute -top-px -right-px size-(--reach) rounded-tr-inherit border-t-2 border-r-2 border-primary [mask-image:linear-gradient(to_bottom_left,#000_45%,transparent)]' />
    <MicVocalIcon className='absolute -top-[calc(var(--mic)*0.62)] -right-[calc(var(--mic)*0.62)] size-(--mic) text-primary-text drop-shadow-sm' />
  </span>
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

export const KaraokeEdgeMark = ({
  videoId,
  small,
}: {
  videoId: string
  small?: boolean
}) => (useHasKaraoke(videoId) ? <KaraokeEdge small={small} /> : null)

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
