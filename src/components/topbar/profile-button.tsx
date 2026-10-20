import {
  CircleQuestionMarkIcon,
  MonitorDownIcon,
  ShareIcon,
  SquarePlusIcon,
  UserIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useInstallMethod } from '@/lib/pwa'
import { handleRedirect } from '@/utils'

import { GitHubIcon } from '../svgicons'
import { Button } from '../ui/button'

// iOS has no install prompt; Safari installs from its Share sheet
const IosInstallDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Install Synbox</DialogTitle>
        <DialogDescription>
          Add Synbox to your Home Screen to open it full screen, like an app.
        </DialogDescription>
      </DialogHeader>
      <ol className='flex flex-col gap-3 text-base'>
        <li className='flex items-center gap-3'>
          <ShareIcon className='size-5 shrink-0 text-primary' />
          <span>
            Tap <strong>Share</strong> in Safari&apos;s toolbar
          </span>
        </li>
        <li className='flex items-center gap-3'>
          <SquarePlusIcon className='size-5 shrink-0 text-primary' />
          <span>
            Choose <strong>Add to Home Screen</strong>
          </span>
        </li>
      </ol>
    </DialogContent>
  </Dialog>
)

const ProfileButtonDropdown = () => {
  const navigate = useNavigate()
  const install = useInstallMethod()
  const [iosHelpOpen, setIosHelpOpen] = useState(false)

  const handleAboutOnClick = () => {
    void navigate('/about')
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline-primary' size='icon'>
            <UserIcon className='size-6 shrink-0 fill-current' />
            <span className='sr-only'>Toggle Profile</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='end'
          sideOffset={10}
          variant='primary'
          className='w-56 overflow-auto'>
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
            {(install.kind === 'prompt' || install.kind === 'ios') && (
              <DropdownMenuItem
                className='cursor-pointer'
                onClick={() => {
                  if (install.kind === 'prompt') {
                    void install.prompt()
                  } else {
                    setIosHelpOpen(true)
                  }
                }}>
                <MonitorDownIcon className='mr-2 size-5 shrink-0' />
                <span>Install App</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <p className='px-2 pt-1 pb-1.5 text-xs text-muted-foreground'>
            Version {__BUILD_ID__}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      <IosInstallDialog open={iosHelpOpen} onOpenChange={setIosHelpOpen} />
    </>
  )
}

export default ProfileButtonDropdown
