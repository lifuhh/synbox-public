import { WandSparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePortrait } from '@/hooks/use-media-query'
import { startGeneration } from '@/lib/generation/store'
import { useGetLyricsVersions } from '@/lib/react-query/queries-and-mutations'
import { cn } from '@/utils/cn'

import { RailButton, RailTooltip } from './rail-button'

// A regeneration is saved as a new version and becomes the default; the versions page rolls back
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
        collisionPadding={8}
        variant='primary-surface'>
        <DropdownMenuItem
          onSelect={() => {
            startGeneration({ mode: 'regenerate', videoId })
          }}>
          Regenerate Lyrics
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            startGeneration({
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
