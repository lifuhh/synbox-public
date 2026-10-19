import { WandSparklesIcon } from 'lucide-react'
import { Link } from 'react-router'

import RequestDialog from '@/components/shared/RequestDialog'
import { Dialog } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import useRequestDialog from '@/hooks/useRequestDialog'
import { useGetLyricsVersions } from '@/lib/react-query/queriesAndMutations'

// Regenerating keeps the current lyrics and saves the result as a new version to preview
export const LyricsVersionsMenu = ({ videoId }: { videoId: string }) => {
  const dialog = useRequestDialog()
  const { data } = useGetLyricsVersions(videoId)
  const count = data?.versions.length ?? 0

  return (
    <>
      {/* Not modal: a modal menu closing as the dialog opens can leave the page unclickable */}
      <DropdownMenu modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <ToggleGroupItem
                value='lyricsVersionsButton'
                variant='default'
                aria-label='Lyrics Versions'
                className='h-10 w-10 cursor-pointer rounded-lg bg-primary text-white invisible-ring'>
                <WandSparklesIcon className='size-6 shrink-0' />
              </ToggleGroupItem>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent
            side='right'
            align='start'
            sideOffset={6}
            alignOffset={-4}
            className='border-none bg-primary unhighlightable'>
            Lyrics Versions
          </TooltipContent>
        </Tooltip>
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
