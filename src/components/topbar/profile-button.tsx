import { useQueryClient } from '@tanstack/react-query'
import {
  CircleQuestionMarkIcon,
  EllipsisVerticalIcon,
  LoaderCircleIcon,
  LockIcon,
  ShieldIcon,
  LogOutIcon,
  MonitorDownIcon,
  UserIcon,
} from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { GoogleMark } from '@/components/shared/google-mark'
import { UserAvatar } from '@/components/shared/user-avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { lastAccount, signInWithGoogle, signOut, useMe } from '@/lib/auth'
import type { Quota } from '@/lib/auth'
import { forgetMySongs } from '@/lib/offline/sync'
import { useInstallMethod } from '@/lib/pwa'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { newTabHandlers } from '@/lib/selectable-links'
import { cn } from '@/utils/cn'

import { Button } from '../ui/button'

// Its own chunk: only a browser without an install prompt opens it
const InstallGuideDialog = lazy(
  async () => await import('./install-guide-dialog')
)

export const quotaText = ({ limit, used }: Quota) => {
  if (limit === null) {
    return 'No song limit'
  }
  if (limit === 0) {
    return 'Generating songs is invite-only for now'
  }
  return `${Math.max(limit - used, 0)} of ${limit} new songs left today`
}

// Google is the only way in, so Sign In goes straight to it: no panel to wait for. It shows it is on its way at
// once (the round trip to the auth server comes before Google's page)
const SignInButton = () => {
  const [pending, setPending] = useState(false)
  // On its way to Google the page leaves; anything else lets the pill be pressed again
  const signIn = async () => {
    const result = await signInWithGoogle()
    if (result === null || result.error !== null) {
      setPending(false)
    }
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            // Under 360px wide the G alone, a round button still named Sign In
            size='pill-collapse'
            gap='md'
            aria-busy={pending || undefined}
            onClick={() => {
              if (!pending) {
                setPending(true)
                void signIn()
              }
            }}>
            {/* As far from the pill's left edge as from its top and bottom */}
            {pending ? (
              <LoaderCircleIcon
                aria-hidden
                className='-ml-1 size-[18px] shrink-0 animate-spin motion-reduce:animate-none max-[359px]:ml-0 sm:-ml-2'
              />
            ) : (
              <GoogleMark className='-ml-1 max-[359px]:ml-0 sm:-ml-2' />
            )}
            <span className='max-[359px]:sr-only'>Sign In</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side='bottom' align='end' sideOffset={10}>
          Signing in accepts our Privacy Policy
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// The account button, or for a guest the More button beside Sign In. Until the session check answers it shows
// what this browser had last time (the account button with the picture it had, or Sign In), and fades over only
// when the answer turns out different
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
      // On a phone the top bar is a grid of icon-sized cells; More and the Sign In pill take three
      className={cn(
        'flex items-center',
        slot !== shownSlot && 'appear',
        slot === 'guest' && 'gap-1 max-sm:col-span-3 sm:gap-3'
      )}
      onAnimationEnd={() => {
        setShownSlot(slot)
      }}>
      {slot === 'account' ? (
        <DropdownMenuTrigger asChild>
          <Button variant='toolbar' size='icon' {...newTabHandlers('/you')}>
            <UserAvatar
              className='size-6'
              src={image === '' ? null : image}
              fallback={<UserIcon className='size-6 shrink-0 fill-current' />}
            />
            <span className='sr-only'>Account</span>
          </Button>
        </DropdownMenuTrigger>
      ) : (
        <>
          <DropdownMenuTrigger asChild>
            <Button variant='toolbar' size='icon'>
              <EllipsisVerticalIcon className='h-6 w-6 shrink-0' />
              <span className='sr-only'>More</span>
            </Button>
          </DropdownMenuTrigger>
          <SignInButton />
        </>
      )}
    </span>
  )
}

const ProfileButtonDropdown = () => {
  const install = useInstallMethod()
  // Mounted from its first opening on, so it can animate closed
  const [guide, setGuide] = useState<'closed' | 'open' | null>(null)
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
            <DropdownMenuItem asChild className='cursor-pointer'>
              <Link to='/privacy'>
                <LockIcon className='mr-2 size-5 shrink-0' />
                <span>Privacy Policy</span>
              </Link>
            </DropdownMenuItem>
            {install.kind !== 'installed' && (
              <DropdownMenuItem
                className='cursor-pointer'
                onClick={() => {
                  if (install.kind === 'prompt') {
                    void install.prompt()
                  } else {
                    setGuide('open')
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
      {guide !== null && (
        <Suspense>
          <InstallGuideDialog
            open={guide === 'open'}
            onOpenChange={(open) => {
              setGuide(open ? 'open' : 'closed')
            }}
          />
        </Suspense>
      )}
    </>
  )
}

export default ProfileButtonDropdown
