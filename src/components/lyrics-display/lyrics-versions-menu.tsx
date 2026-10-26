import { WandSparklesIcon } from 'lucide-react'
import { use, useState } from 'react'
import { Link } from 'react-router'

import { startFromButton } from '@/components/generation/start-generation'
import { AdminCornerMark } from '@/components/shared/admin-mark'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePortrait } from '@/hooks/use-media-query'
import { useMenuOffset } from '@/lib/menu-offset'
import { useGetLyricsVersions } from '@/lib/react-query/queries-and-mutations'
import { cn } from '@/utils/cn'

import { RailButton, RailInline, railMenuSide } from './rail-button'

// Admins only (the rail shows it to no one else; the gear says so): a regeneration is saved as a new version
// and becomes the default; the versions page rolls back
export const LyricsVersionsMenu = ({ videoId }: { videoId: string }) => {
  const [open, setOpen] = useState(false)
  const portrait = usePortrait()
  const inline = use(RailInline)
  // In a row (the watch page, or a phone's rail) the menu centres on its button
  const inRow = portrait || inline
  const { data } = useGetLyricsVersions(videoId)
  const count = data?.versions.length ?? 0
  const side = railMenuSide(inline, portrait)
  const { measure, offset, triggerRef } = useMenuOffset<HTMLButtonElement>(side)

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next) {
          measure()
        }
        setOpen(next)
      }}>
      <DropdownMenuTrigger asChild>
        <RailButton
          ref={triggerRef}
          label='Lyrics Versions'
          className={cn('relative', open && 'bg-white/10')}>
          <WandSparklesIcon className='size-5 shrink-0' />
          <AdminCornerMark />
        </RailButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={inRow ? 'center' : 'start'}
        sideOffset={offset}
        collisionPadding={8}>
        <DropdownMenuItem
          onSelect={() => {
            void startFromButton({ mode: 'regenerate', videoId })
          }}>
          Regenerate Lyrics
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void startFromButton({
              mode: 'regenerate',
              skipUploaderLyrics: true,
              videoId,
            })
          }}>
          Regenerate Without Uploader Lyrics
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/v/${videoId}/versions`}>
            {count > 0 ? `All Versions (${count})` : 'All Versions'}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
