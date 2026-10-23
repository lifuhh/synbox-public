import { LibraryBigIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { LibraryView } from '@/components/library/library'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { newTabHandlers } from '@/lib/selectable-links'

// The top bar's one place for the user's songs: Bookmarks, Playlists, Generated and History, opened by a click
const LibraryMenu = () => {
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='toolbar' size='icon' {...newTabHandlers('/library')}>
          <LibraryBigIcon className='h-6 w-6 shrink-0' />
          <span className='sr-only'>Library</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={panel}
        align='end'
        sideOffset={10}
        collisionPadding={8}
        variant='floating'
        aria-label='Library'
        onOpenAutoFocus={(event) => {
          // The search field takes focus with a keyboard at hand; on a phone it would pull the keyboard up
          // over the list, so the panel itself takes it (a screen reader starts there)
          if (matchMedia('(pointer: coarse)').matches) {
            event.preventDefault()
            panel.current?.focus({ preventScroll: true })
          }
        }}
        className='flex max-h-[min(38rem,calc(var(--radix-popover-content-available-height)-var(--safe-bottom)))] w-[min(28rem,calc(100vw-1rem-var(--safe-left)-var(--safe-right)))] flex-col overflow-hidden'>
        {/* Mounted only while open, so the offline copy syncs and searches only then */}
        <LibraryView
          variant='menu'
          onLeave={() => {
            setOpen(false)
          }}
          onReturn={() => {
            setOpen(true)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export default LibraryMenu
