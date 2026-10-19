import { WandSparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import RequestDialog from '@/components/shared/RequestDialog'
import { Dialog } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import useRequestDialog from '@/hooks/useRequestDialog'
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
  const dialog = useRequestDialog()
  const { data } = useGetLyricsVersions(videoId)
  const count = data?.versions.length ?? 0

  return (
    <>
      {/* Not modal: a modal menu closing as the dialog opens can leave the page unclickable */}
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
              dialog.openFor(videoId)
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
      <Dialog open={dialog.open} onOpenChange={dialog.handleOpenChange}>
        {dialog.videoId !== '' && (
          <RequestDialog
            key={dialog.dialogKey}
            videoId={dialog.videoId}
            handleClose={dialog.close}
            mode='regenerate'
          />
        )}
      </Dialog>
    </>
  )
}
