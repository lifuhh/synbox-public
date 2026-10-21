import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { GitHubIcon } from '../svgicons'

export const REPO_URL = 'https://github.com/lifuhh/synbox'

// The source, where open-source apps keep it: an icon in the top bar. Phones have no room, so there it sits in
// the account menu
const GitHubButton = () => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant='toolbar' size='icon' asChild>
          <a href={REPO_URL} target='_blank' rel='noreferrer'>
            <GitHubIcon className='size-5 fill-current' />
            <span className='sr-only'>GitHub</span>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent variant='accent'>GitHub</TooltipContent>
    </Tooltip>
  </TooltipProvider>
)

export default GitHubButton
