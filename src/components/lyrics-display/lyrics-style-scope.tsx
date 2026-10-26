import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { Button } from '@/components/ui/button'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'
import {
  lyricsPositionsMovedAtom,
  lyricsStyleScopeAtom,
  lyricsStyleSourceAtom,
  resetLyricsPositionsAtom,
} from '@/context/atoms'
import type { LyricsStyleScope } from '@/context/atoms'
import { cn } from '@/utils/cn'

// A choice in a segmented track (rounded-lg, p-1): its corners are the track's less the padding
export const SEGMENT =
  'rounded-sm py-1.5 text-xs font-medium transition-colors touch:py-3 touch:text-sm'

// A style change that drops what was there, with the app's short Undo toast (as removing a song from the queue)
const offerUndo = (title: string, undo: (() => void) | null) => {
  if (undo === null) {
    return
  }
  toast({
    action: (
      <ToastAction altText={`Undo: ${title}`} onClick={undo}>
        Undo
      </ToastAction>
    ),
    duration: 5000,
    title,
  })
}

const SCOPES: { id: LyricsStyleScope; name: string }[] = [
  { id: 'all', name: 'All Songs' },
  { id: 'song', name: 'This Song' },
]

// Where the panel's changes (and a drag of the lyrics) go, and what the song follows: This Song gives it a style of its
// own, All Songs puts it back on the viewer's default (letting its own go, with Undo, and any shared style showing).
// The choice is the state, so the panel needs no Apply or Reset buttons for it (owner, 2026-10-26); to make a look
// every song's, choose All Songs and set it
export const LyricsStyleScopeSection = () => {
  const [scope, setScope] = useAtom(lyricsStyleScopeAtom)
  const source = useAtomValue(lyricsStyleSourceAtom)
  if (source === null) {
    return null
  }
  return (
    <section className='flex flex-col gap-2'>
      {/* No visible heading: "All Songs" and "This Song" say what they choose */}
      <div
        role='radiogroup'
        aria-label='Changes Apply To'
        className='grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1'>
        {SCOPES.map((option) => (
          <button
            key={option.id}
            type='button'
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- segmented buttons in an ARIA radio group, like the backdrop picker
            role='radio'
            aria-checked={scope === option.id}
            onClick={() => {
              offerUndo('Song Style Reset', setScope(option.id))
            }}
            className={cn(
              SEGMENT,
              scope === option.id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {option.name}
          </button>
        ))}
      </div>
    </section>
  )
}

// Puts the lyrics and their translation back where they start (with Undo). Offered only after the listener moved
// something, beside the layout switches it belongs with; quiet text drawn 32px, its press area 44px on touch, its word
// on the panel's edge. Always the way out of a layout that got stuck (2026-10-26-fix-lyrics-dock-layout)
export const ResetPositions = () => {
  const moved = useAtomValue(lyricsPositionsMovedAtom)
  const resetPositions = useSetAtom(resetLyricsPositionsAtom)
  if (!moved) {
    return null
  }
  return (
    <Button
      variant='quiet'
      size='text'
      className='-ml-2 self-start'
      onClick={() => {
        offerUndo('Positions Reset', resetPositions())
      }}>
      Reset Positions
    </Button>
  )
}
