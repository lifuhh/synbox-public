import { CircleQuestionMarkIcon, UserIcon } from 'lucide-react'
import { useNavigate } from 'react-router'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { handleRedirect } from '@/utils'

import { GitHubIcon } from '../svgicons'
import { Button } from '../ui/button'

const ProfileButtonDropdown = () => {
  const navigate = useNavigate()

  const handleAboutOnClick = () => {
    navigate('/about')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='icon'
          className='border-primary/80 invisible-ring hover:border-white'>
          <UserIcon className='size-6 shrink-0 fill-current' />
          <span className='sr-only'>Toggle Profile</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        sideOffset={10}
        className='w-56 overflow-auto border border-primary bg-popover'>
        <DropdownMenuGroup>
          <DropdownMenuItem
            className='cursor-pointer'
            onClick={() => {
              handleRedirect('https://github.com/lifuhh/')
            }}>
            <GitHubIcon className='mr-2 ml-[3px] h-4 w-4 fill-white' />
            <span>GitHub</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className='cursor-pointer'
            onClick={handleAboutOnClick}>
            <CircleQuestionMarkIcon className='mr-2 size-5 shrink-0' />
            <span>About Synbox</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ProfileButtonDropdown
