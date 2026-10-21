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

// The same mark on a thumbnail: a folded top-right corner in the accent with a mic, like a sticker on cover
// art, so the title beside or under the picture keeps its full width. 'sm' for list thumbnails (~96px wide),
// 'md' for cards
export const KaraokeCorner = ({ size = 'md' }: { size?: 'sm' | 'md' }) => (
  <span
    className={cn(
      'pointer-events-none absolute top-0 right-0 bg-primary text-primary-foreground corner-fold',
      size === 'sm' ? 'size-5' : 'size-8'
    )}>
    <MicVocalIcon
      aria-hidden
      className={cn(
        'absolute',
        size === 'sm' ? 'top-0.5 right-0.5 size-2.5' : 'top-1 right-1 size-3.5'
      )}
    />
    <span className='sr-only'>Karaoke Lyrics</span>
  </span>
)

export const KaraokeCornerMark = ({
  videoId,
  size,
}: {
  videoId: string
  size?: 'sm' | 'md'
}) => (useHasKaraoke(videoId) ? <KaraokeCorner size={size} /> : null)

// The badge for a song known only by its id, from the library list
export const KaraokeMark = ({
  videoId,
  className,
}: {
  videoId: string
  className?: string
}) => (useHasKaraoke(videoId) ? <KaraokeBadge className={className} /> : null)
