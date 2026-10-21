import { useQueryClient } from '@tanstack/react-query'
import {
  CircleQuestionMarkIcon,
  ShieldIcon,
  LogInIcon,
  LogOutIcon,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { signInWithGoogle, signOut, useMe } from '@/lib/auth'
import type { Quota } from '@/lib/auth'
import { forgetMySongs } from '@/lib/offline/sync'
import { useInstallMethod } from '@/lib/pwa'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { handleRedirect } from '@/utils'
import { cn } from '@/utils/cn'

import { GitHubIcon } from '../svgicons'
import { Button } from '../ui/button'
import { REPO_URL } from './github-button'

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
          <ShareIcon className='size-5 shrink-0 text-primary-text' />
          <span>
            Tap <strong>Share</strong> in Safari&apos;s toolbar
          </span>
        </li>
        <li className='flex items-center gap-3'>
          <SquarePlusIcon className='size-5 shrink-0 text-primary-text' />
          <span>
            Choose <strong>Add to Home Screen</strong>
          </span>
        </li>
      </ol>
    </DialogContent>
  </Dialog>
)

// Pictures this page has already shown, so a remounted top bar shows them at once instead of fading in again
const loadedAvatars = new Set<string>()

// The person icon stays until the picture has fully loaded, then the two crossfade; signing out fades back
const Avatar = ({ src }: { src: string | null }) => {
  const [lastSrc, setLastSrc] = useState(src)
  const [loaded, setLoaded] = useState(src !== null && loadedAvatars.has(src))
  if (src !== null && src !== lastSrc) {
    setLastSrc(src)
    setLoaded(loadedAvatars.has(src))
  }
  const shown = src !== null && loaded

  return (
    <span className='relative grid size-full place-items-center'>
      <UserIcon
        className={cn(
          'size-6 shrink-0 fill-current transition-opacity duration-300 motion-reduce:transition-none',
          shown && 'opacity-0'
        )}
      />
      {lastSrc !== null && (
        <img
          key={lastSrc}
          src={lastSrc}
          alt=''
          referrerPolicy='no-referrer'
          onLoad={() => {
            loadedAvatars.add(lastSrc)
            setLoaded(true)
          }}
          className={cn(
            'absolute inset-0 size-full rounded-full object-cover transition-opacity duration-300 motion-reduce:transition-none',
            !shown && 'opacity-0'
          )}
        />
      )}
    </span>
  )
}

const quotaText = ({ limit, used }: Quota) => {
  if (limit === null) {
    return 'No song limit'
  }
  if (limit === 0) {
    return 'Generating songs is invite-only for now'
  }
  return `${Math.max(limit - used, 0)} of ${limit} new songs left this hour`
}

const ProfileButtonDropdown = () => {
  const navigate = useNavigate()
  const install = useInstallMethod()
  const [iosHelpOpen, setIosHelpOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data: me, isPending } = useMe()
  const user = me?.user ?? null

  const handleSignOut = async () => {
    await signOut()
    forgetMySongs()
    await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GET_ME] })
  }

  const handleAboutOnClick = () => {
    void navigate('/about')
  }

  return (
    <>
      <DropdownMenu>
        {/* Until the session is known the slot holds an avatar's space, so a signed-in visit never flashes
            Sign In; a guest gets a labelled button rather than an empty person icon */}
        {isPending ? (
          <span aria-hidden className='size-10' />
        ) : (
          <span key={user ? 'account' : 'guest'} className='flex appear'>
            <DropdownMenuTrigger asChild>
              {user ? (
                <Button variant='toolbar' size='icon'>
                  <Avatar
                    src={user.image === '' ? null : (user.image ?? null)}
                  />
                  <span className='sr-only'>Account</span>
                </Button>
              ) : (
                <Button size='pill'>Sign In</Button>
              )}
            </DropdownMenuTrigger>
          </span>
        )}
        <DropdownMenuContent
          align='end'
          sideOffset={10}
          className='w-64 overflow-auto'>
          {user ? (
            <div className='flex flex-col gap-0.5 px-2 pt-1.5 pb-2'>
              <p className='truncate text-sm font-medium'>{user.name}</p>
              <p className='truncate text-xs text-muted-foreground'>
                {user.email}
              </p>
              {me?.quota && (
                <p className='pt-1 text-xs text-muted-foreground'>
                  {quotaText(me.quota)}
                </p>
              )}
            </div>
          ) : null}
          {user ? null : (
            <>
              <div className='flex flex-col gap-2 px-2 pt-1.5 pb-2'>
                <p className='text-sm text-pretty text-muted-foreground'>
                  Sign in to generate more songs and find them on every device.
                </p>
                <DropdownMenuItem
                  variant='primary'
                  className='cursor-pointer'
                  onClick={() => {
                    void signInWithGoogle()
                  }}>
                  <LogInIcon className='mr-2 size-5 shrink-0' />
                  <span>Continue With Google</span>
                </DropdownMenuItem>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            {/* From sm up the top bar shows GitHub itself */}
            <DropdownMenuItem
              className='cursor-pointer sm:hidden'
              onClick={() => {
                handleRedirect(REPO_URL)
              }}>
              <GitHubIcon className='mr-2 ml-[3px] h-4 w-4 fill-white' />
              <span>GitHub</span>
            </DropdownMenuItem>
            {user?.role === 'admin' && (
              <DropdownMenuItem
                className='cursor-pointer'
                onClick={() => {
                  void navigate('/admin')
                }}>
                <ShieldIcon className='mr-2 size-5 shrink-0' />
                <span>Admin</span>
              </DropdownMenuItem>
            )}
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
          {user ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className='cursor-pointer'
                onClick={() => {
                  void handleSignOut()
                }}>
                <LogOutIcon className='mr-2 size-5 shrink-0' />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </>
          ) : null}
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
