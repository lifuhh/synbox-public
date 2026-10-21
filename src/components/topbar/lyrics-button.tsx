import { BookOpenTextIcon } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// The lyrics pages: saved songs to read or play along, online or offline
const LyricsButton = () => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant='outline-primary' size='icon' asChild>
          <Link to='/lyrics'>
            <BookOpenTextIcon className='h-6 w-6 shrink-0' />
            <span className='sr-only'>Lyrics</span>
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent variant='accent'>Lyrics</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)

export default LyricsButton
