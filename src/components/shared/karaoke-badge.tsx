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

// The mic's box, the gap between it and each stroke, and each stroke's length
const EDGE: CssVars = { '--gap': '0.125rem', '--mic': '0.875rem', '--stroke': '0.875rem' }
const SMALL_EDGE: CssVars = { '--gap': '0.125rem', '--mic': '0.75rem', '--stroke': '0.625rem' }

// The same mark on a list row's thumbnail: a mic on its top-right corner, centred on the corner, with a short
// stroke of the accent running into it along the top edge and out of it down the right edge, both on the mic's
// centre lines, so a karaoke song stands out in a list at a glance without framing the whole picture. Laid over
// the thumbnail, which must not clip it: the thumbnail rounds its own picture instead of hiding its overflow.
// `small` for the saved menu's 80px thumbnails
export const KaraokeEdge = ({ small = false }: { small?: boolean }) => (
  <span
    aria-hidden
    data-karaoke-badge
    style={small ? SMALL_EDGE : EDGE}
    className='pointer-events-none absolute inset-0'>
    <span className='absolute top-0 right-[calc(var(--mic)/2+var(--gap))] h-0.5 w-(--stroke) -translate-y-1/2 rounded-full bg-primary' />
    <span className='absolute top-[calc(var(--mic)/2+var(--gap))] right-0 h-(--stroke) w-0.5 translate-x-1/2 rounded-full bg-primary' />
    <MicVocalIcon className='absolute top-0 right-0 size-(--mic) translate-x-1/2 -translate-y-1/2 text-primary-text drop-shadow-[0_1px_1px_rgb(0_0_0/0.6)]' />
  </span>
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
