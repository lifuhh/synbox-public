import { WandSparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { startFromButton } from '@/components/generation/start-generation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePortrait } from '@/hooks/use-media-query'
import { useGetLyricsVersions } from '@/lib/react-query/queries-and-mutations'
import { cn } from '@/utils/cn'

import { RailButton, RailTooltip } from './rail-button'

// Admins only (the rail shows it to no one else): a regeneration is saved as a new version and becomes the
// default; the versions page rolls back
export const LyricsVersionsMenu = ({ videoId }: { videoId: string }) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const portrait = usePortrait()
  const { data } = useGetLyricsVersions(videoId)
  const count = data?.versions.length ?? 0

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <RailTooltip label='Lyrics Versions' hidden={menuOpen}>
        <DropdownMenuTrigger asChild>
          <RailButton
            label='Lyrics Versions'
            className={cn(menuOpen && 'bg-white/10')}>
            <WandSparklesIcon className='size-5 shrink-0' />
          </RailButton>
        </DropdownMenuTrigger>
      </RailTooltip>
      <DropdownMenuContent
        side={portrait ? 'bottom' : 'right'}
        align={portrait ? 'center' : 'start'}
        sideOffset={8}
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
