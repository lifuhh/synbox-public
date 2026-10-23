import { BookOpenTextIcon } from 'lucide-react'
import { useState } from 'react'

import {
  ShelfControls,
  ShelfResults,
  SyncStatusLine,
  useLyricsShelf,
} from '@/components/offline/lyrics-shelf'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useHoverMenu } from '@/hooks/use-hover-menu'
import { newTabHandlers } from '@/lib/selectable-links'

// Mounted only while the menu is open, so the shelf syncs and searches only then
const LyricsPanel = ({ onOpen }: { onOpen: () => void }) => {
  const shelf = useLyricsShelf()
  return (
    <>
      <div className='p-3 pb-2'>
        <SyncStatusLine shelf={shelf} spacingClassName='pb-2' />
        <div className='flex flex-col gap-2'>
          <ShelfControls shelf={shelf} />
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1'>
        <ShelfResults shelf={shelf} onOpen={onOpen} />
      </div>
    </>
  )
}

// The saved songs to read or play along, online or offline: a menu like Saved, each song opening its reader
const LyricsButton = () => {
  const [open, setOpen] = useState(false)
  const menu = useHoverMenu(open, setOpen)
  return (
    <Popover open={open} onOpenChange={setOpen} modal={!menu.byMouse}>
      <PopoverTrigger asChild>
        <Button
          variant='toolbar'
          size='icon'
          {...menu.triggerAfter(newTabHandlers('/lyrics'))}>
          <BookOpenTextIcon className='h-6 w-6 shrink-0' />
          <span className='sr-only'>Lyrics</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='end'
        sideOffset={10}
        collisionPadding={8}
        variant='floating'
        aria-label='Lyrics'
        {...menu.content}
        onOpenAutoFocus={(event) => {
          menu.content.onOpenAutoFocus(event)
          // The search field takes focus with a keyboard at hand; on a phone it would pull the keyboard up
          // over the list
          if (matchMedia('(pointer: coarse)').matches) {
            event.preventDefault()
          }
        }}
        className='flex max-h-[min(38rem,calc(var(--radix-popover-content-available-height)-var(--safe-bottom)))] w-[min(28rem,calc(100vw-1rem-var(--safe-left)-var(--safe-right)))] flex-col overflow-hidden'>
        <LyricsPanel
          onOpen={() => {
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export default LyricsButton
