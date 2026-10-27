import { useQueryClient } from '@tanstack/react-query'
import {
  CircleQuestionMarkIcon,
  EllipsisVerticalIcon,
  LoaderCircleIcon,
  MailIcon,
  MessageSquareIcon,
  ShieldIcon,
  LogOutIcon,
  MonitorDownIcon,
  SparklesIcon,
  UserIcon,
} from 'lucide-react'
import { lazy, Suspense, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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
import { openRequestMore } from '@/lib/account-prompts'
import {
  SONGS_A_DAY,
  lastAccount,
  signInWithGoogle,
  signOut,
  songsLeftText,
  useMe,
} from '@/lib/auth'
import { WRITE_HINTS } from '@/lib/feedback'
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
// Their own chunks too: loaded on the first press of Contact Me or Send Feedback
const ContactDialog = lazy(
  async () => await import('@/components/shared/contact-dialog')
)
const FeedbackDialog = lazy(
  async () => await import('@/components/shared/feedback-dialog')
)

// A menu item's secondary line, on its label's line: read as the item's description (aria-describedby), so its
// accessible name stays the label alone
const MenuHint = ({ id, children }: { id: string; children: ReactNode }) => (
  <span id={id} aria-hidden className='ml-2 text-xs text-muted-foreground'>
    {children}
  </span>
)

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
            // Under 360px wide the G alone, a round button still named Sign In. A ghost like the icon buttons beside
            // it, outlined (button.tsx › toolbar-outline)
            variant='toolbar-outline'
            size='pill-collapse'
            gap='md'
            // The top bar's wide padding (topbar-x) leaves 8px for a ghost button's invisible edge; this pill draws its
            // edge, so it steps in by that 8px to line up with the page's content edge
            className='lg:mr-2'
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
              <GoogleMark bare className='-ml-1 max-[359px]:ml-0 sm:-ml-2' />
            )}
            <span className='max-[359px]:sr-only'>Sign In</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side='bottom' align='end' sideOffset={10}>
          <div className='flex flex-col gap-0.5'>
            <span>
              {SONGS_A_DAY} new songs a day, your style on every device
            </span>
            <span className='text-muted-foreground'>
              Signing in accepts our Privacy Policy
            </span>
          </div>
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
  const [contact, setContact] = useState<'closed' | 'open' | null>(null)
  const [feedback, setFeedback] = useState<'closed' | 'open' | null>(null)
  const hintId = useId()
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
        {/* As wide as its longest line, within a floor and a ceiling: a long name or email truncates. Privacy and
            Terms live in the footers of Home, About and the policies themselves, not here */}
        <DropdownMenuContent
          align='end'
          sideOffset={10}
          className='w-max max-w-64 min-w-44 overflow-auto'>
          {user ? (
            <div className='flex flex-col gap-0.5 px-2 pt-1.5 pb-2'>
              <p className='truncate text-sm font-medium'>{user.name}</p>
              <p
                title={user.email}
                className='truncate text-xs text-muted-foreground'>
                {user.email}
              </p>
              {me?.quota && (
                <p className='pt-1 text-xs text-muted-foreground'>
                  {songsLeftText(me.quota)}
                </p>
              )}
            </div>
          ) : null}
          <DropdownMenuGroup>
            {me?.quota !== undefined &&
              me.quota.limit !== null &&
              me.quota.request?.status !== 'open' && (
                <DropdownMenuItem
                  className='cursor-pointer'
                  onClick={openRequestMore}>
                  <SparklesIcon className='mr-2 size-5 shrink-0' />
                  <span>Request More Songs</span>
                </DropdownMenuItem>
              )}
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
            <DropdownMenuItem
              className='cursor-pointer'
              aria-describedby={`${hintId}-feedback`}
              onClick={() => {
                setFeedback('open')
              }}>
              <MessageSquareIcon className='mr-2 size-5 shrink-0' />
              <span>Send Feedback</span>
              <MenuHint id={`${hintId}-feedback`}>
                {WRITE_HINTS.feedback}
              </MenuHint>
            </DropdownMenuItem>
            <DropdownMenuItem
              className='cursor-pointer'
              aria-describedby={`${hintId}-contact`}
              onClick={() => {
                setContact('open')
              }}>
              <MailIcon className='mr-2 size-5 shrink-0' />
              <span>Contact Me</span>
              <MenuHint id={`${hintId}-contact`}>
                {WRITE_HINTS.contact}
              </MenuHint>
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
      {feedback !== null && (
        <Suspense>
          <FeedbackDialog
            open={feedback === 'open'}
            onOpenChange={(open) => {
              setFeedback(open ? 'open' : 'closed')
            }}
          />
        </Suspense>
      )}
      {contact !== null && (
        <Suspense>
          <ContactDialog
            open={contact === 'open'}
            onOpenChange={(open) => {
              setContact(open ? 'open' : 'closed')
            }}
          />
        </Suspense>
      )}
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
