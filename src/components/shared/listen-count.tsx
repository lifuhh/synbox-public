import { PlayIcon } from 'lucide-react'

import { compactCount, listensText, useListenCounts } from '@/lib/song-stats'

// A song card's listens, before its channel ("▷ 1.2K"), as on YouTube; nothing for a song played ten times or fewer
export const ListenCount = ({ videoId }: { videoId: string }) => {
  const { data } = useListenCounts()
  const listens = data?.[videoId]
  if (listens === undefined) {
    return null
  }
  return (
    <span
      title={listensText(listens)}
      className='inline-flex shrink-0 items-center gap-0.5 tabular-nums'>
      <PlayIcon aria-hidden className='size-[1.1em]' />
      <span className='sr-only'>{listensText(listens)}</span>
      <span aria-hidden>{compactCount(listens)}</span>
    </span>
  )
}
