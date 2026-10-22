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
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { UserAvatar } from '@/components/shared/user-avatar'
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
import { lastAccount, signInWithGoogle, signOut, useMe } from '@/lib/auth'
import type { Quota } from '@/lib/auth'
import { forgetMySongs } from '@/lib/offline/sync'
import { useInstallMethod } from '@/lib/pwa'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { newTabHandlers } from '@/lib/selectable-links'
import { cn } from '@/utils/cn'

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

export const quotaText = ({ limit, used }: Quota) => {
  if (limit === null) {
    return 'No song limit'
  }
  if (limit === 0) {
    return 'Generating songs is invite-only for now'
  }
  return `${Math.max(limit - used, 0)} of ${limit} new songs left this hour`
}

// The account button, or Sign In for a guest. Until the session check answers it shows the control this
// browser had last time (the account button with the picture it had, or Sign In), and fades over only when
// the answer turns out different
const ProfileTrigger = ({
  user,
  pending,
}: {
  user: { image: string | null } | null
  pending: boolean
}) => {
  const remembered = useMemo(() => lastAccount(), [])
  const account = pending ? remembered : user
  const slot = account === null ? 'guest' : 'account'
  const [shownSlot, setShownSlot] = useState(slot)
  const image = account?.image ?? null
  return (
    <span
      key={slot}
      // On a phone the top bar is a grid of icon-sized cells; the Sign In pill takes two, centred in the row
      className={cn(
        'flex items-center',
        slot !== shownSlot && 'appear',
        slot === 'guest' && 'max-sm:col-span-2'
      )}
      onAnimationEnd={() => {
        setShownSlot(slot)
      }}>
      <DropdownMenuTrigger asChild>
        {slot === 'account' ? (
          <Button variant='toolbar' size='icon' {...newTabHandlers('/you')}>
            <UserAvatar
              className='size-6'
              src={image === '' ? null : image}
              fallback={<UserIcon className='size-6 shrink-0 fill-current' />}
            />
            <span className='sr-only'>Account</span>
          </Button>
        ) : (
          <Button size='pill'>Sign In</Button>
        )}
      </DropdownMenuTrigger>
    </span>
  )
}

const ProfileButtonDropdown = () => {
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

  return (
    <>
      <DropdownMenu>
        <ProfileTrigger user={user} pending={isPending} />
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
                <DropdownMenuItem
                  asChild
                  variant='note'
                  className='cursor-pointer'>
                  <Link to='/privacy'>
                    <span>
                      By signing in, you accept our{' '}
                      <span className='underline underline-offset-2'>
                        Privacy Policy
                      </span>
                    </span>
                  </Link>
                </DropdownMenuItem>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            {user?.role === 'admin' && (
              <DropdownMenuItem asChild className='cursor-pointer'>
                <Link to='/admin'>
                  <ShieldIcon className='mr-2 size-5 shrink-0' />
                  <span>Admin</span>
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild className='cursor-pointer'>
              <Link to='/about'>
                <CircleQuestionMarkIcon className='mr-2 size-5 shrink-0' />
                <span>About Synbox</span>
              </Link>
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
