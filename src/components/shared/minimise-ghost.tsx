import { useAtomValue } from 'jotai'

import { resumeSongAtom } from '@/lib/listening/store'
import { cn } from '@/utils/cn'

import { MiniBarView } from './mini-bar-view'
import { DOCK, returnTab, TabNav } from './tab-bar'

// The drag to minimise's landing place on the player (use-drag-to-minimise.ts): the tabs and the mini bar, drawn as
// they will be on the tab the player goes back to, hidden until a drag shows them. The video lands on its thumbnail
export const MinimiseGhost = () => {
  const song = useAtomValue(resumeSongAtom)
  if (song === null) {
    return null
  }
  return (
    <div
      data-minimise-ghost
      aria-hidden
      inert
      className={cn(DOCK, 'invisible')}>
      <MiniBarView song={song} playing />
      <TabNav pathname={returnTab()?.path ?? '/'} />
    </div>
  )
}
