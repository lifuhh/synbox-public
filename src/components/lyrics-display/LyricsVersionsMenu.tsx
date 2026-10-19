import { WandSparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { startGeneration } from '@/lib/generation/store'
import { useGetLyricsVersions } from '@/lib/react-query/queriesAndMutations'
import { cn } from '@/utils/cn'

import { RailButton, RailTooltip } from './RailButton'

// Regenerating keeps the current lyrics and saves the result as a new version to preview
export const LyricsVersionsMenu = ({
  videoId,
  onOpenChange,
}: {
  videoId: string
  onOpenChange?: (open: boolean) => void
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const { data } = useGetLyricsVersions(videoId)
  const count = data?.versions.length ?? 0

  return (
    <>
      <DropdownMenu
        modal={false}
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open)
          onOpenChange?.(open)
        }}>
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
          side='right'
          align='start'
          sideOffset={8}
          className='border border-primary bg-background text-foreground'>
          <DropdownMenuItem
            onSelect={() => {
              startGeneration({ mode: 'regenerate', videoId })
            }}>
            Regenerate Lyrics
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`/v/${videoId}/versions`}>
              {count > 0 ? `All Versions (${count})` : 'All Versions'}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
