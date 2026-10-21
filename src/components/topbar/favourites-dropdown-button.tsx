import { useAtom } from 'jotai'
import { BookBookmarkIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { favoritesAtom } from '@/context/atoms'

import FavouritesDropdownItem from './favourites-dropdown-item'

const FavouritesDropdownButton = () => {
  const [favorites] = useAtom(favoritesAtom)

  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip>
          <DropdownMenuTrigger asChild>
            <TooltipTrigger asChild>
              <Button variant='toolbar' size='icon'>
                <BookBookmarkIcon className='h-6 w-6 shrink-0' />
                <span className='sr-only'>View Bookmarks</span>
              </Button>
            </TooltipTrigger>
          </DropdownMenuTrigger>
          <TooltipContent variant='accent'>View Bookmarks</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align='end'
          collisionPadding={8}
          sideOffset={10}
          variant='panel'
          className='max-h-(--radix-dropdown-menu-content-available-height) w-[min(400px,calc(100vw-1rem))]'>
          <div className='flex flex-col'>
            <div className='sticky top-0 z-10 bg-background/95 p-2'>
              <DropdownMenuLabel variant='heading'>Bookmarks</DropdownMenuLabel>
              <DropdownMenuSeparator />
            </div>

            <div className='max-h-[min(600px,calc(var(--app-h)-var(--topbar-h)-6rem))] overflow-y-auto px-2'>
              {favorites.length > 0 ? (
                <div className='space-y-1 pb-4'>
                  {favorites.toReversed().map((item) => (
                    <FavouritesDropdownItem key={item.videoId} {...item} />
                  ))}
                </div>
              ) : (
                <div className='flex flex-col items-center justify-center py-2 text-center'>
                  <p className='text-lg font-medium text-muted-foreground'>
                    Your bookmarks list is empty
                  </p>
                  <p className='pt-2 pb-4 text-sm text-muted-foreground'>
                    Songs you bookmarked will appear here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
}

export default FavouritesDropdownButton
