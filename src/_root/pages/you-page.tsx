import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronRightIcon,
  CircleQuestionMarkIcon,
  MailIcon,
  UserIcon,
  LogOutIcon,
  ShieldIcon,
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { BenefitList } from '@/components/account/sign-in-sheet'
import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { GoogleMark } from '@/components/shared/google-mark'
import { UserAvatar } from '@/components/shared/user-avatar'
import { Button } from '@/components/ui/button'
import { openRequestMore } from '@/lib/account-prompts'
import {
  requestText,
  signInWithGoogle,
  signOut,
  songsLeftText,
  useMe,
} from '@/lib/auth'
import type { Quota } from '@/lib/auth'
import { forgetMySongs } from '@/lib/offline/sync'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

// Its own chunk: loaded on the first press of Contact Me
const ContactDialog = lazy(
  async () => await import('@/components/shared/contact-dialog')
)

const ROW =
  'flex min-h-12 items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-accent'

// A row that opens a page: its icon, its label, a chevron
const LinkRow = ({
  to,
  icon,
  label,
}: {
  to: string
  icon: ReactNode
  label: string
}) => (
  <Link to={to} className={ROW}>
    <span className='grid size-6 shrink-0 place-items-center text-muted-foreground'>
      {icon}
    </span>
    <span className='min-w-0 flex-1 truncate text-foreground'>{label}</span>
    <ChevronRightIcon
      className='size-5 shrink-0 text-muted-foreground'
      aria-hidden
    />
  </Link>
)

// Under the name: what signing in is for, the songs left today, or the email of a Worker without them
const accountLine = (
  user: { email: string } | null,
  quota: Quota | undefined
) => {
  if (user === null) {
    return 'Browsing stays free for everyone'
  }
  return quota === undefined ? user.email : songsLeftText(quota)
}

// Where the latest request stands, and Request More: a quiet second step for an account on a daily number with no
// request waiting. Nothing at all for an admin
const MoreSongs = ({ quota }: { quota: Quota }) => {
  const request = requestText(quota.request)
  const canRequest = quota.limit !== null && quota.request?.status !== 'open'
  if (request === null && !canRequest) {
    return null
  }
  return (
    <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm'>
      {request !== null && <p className='text-muted-foreground'>{request}</p>}
      {canRequest && (
        <Button
          variant='ghost-subtle'
          className='-mx-3'
          onClick={openRequestMore}>
          Request More
        </Button>
      )}
    </div>
  )
}

// The installed app's You tab: the account and the app's own pages. The songs are in the Library tab
const YouPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  // Mounted from its first opening on, so it can animate closed
  const [contact, setContact] = useState<'closed' | 'open' | null>(null)
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const user = me?.user ?? null
  const quota = me?.quota

  return (
    <section
      ref={setBox}
      data-scroll-top
      className='flex flex-1 flex-col overflow-y-auto px-4 pt-(--topbar-h) pb-page-bottom'>
      <title>You · Synbox</title>
      <div className='mx-auto flex w-full max-w-xl flex-col gap-6 pt-4'>
        <h1 className='px-2 text-3xl font-semibold tracking-tight text-foreground'>
          You
        </h1>

        <div className='flex flex-col gap-3 rounded-2xl bg-card p-4'>
          <div className='flex items-center gap-3'>
            <span className='grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-muted-foreground'>
              <UserAvatar
                src={
                  user?.image === undefined || user.image === ''
                    ? null
                    : user.image
                }
                fallback={
                  <UserIcon className='size-7 fill-current' aria-hidden />
                }
              />
            </span>
            <div className='min-w-0'>
              <p className='truncate font-medium text-foreground'>
                {user ? user.name : 'Sign In to Add Songs'}
              </p>
              <p className='text-sm text-pretty text-muted-foreground'>
                {accountLine(user, quota)}
              </p>
            </div>
          </div>
          {user === null && <BenefitList />}
          {user !== null && quota !== undefined && <MoreSongs quota={quota} />}
          {user ? (
            <Button
              variant='outline'
              gap='md'
              onClick={() => {
                void (async () => {
                  await signOut()
                  forgetMySongs()
                  await queryClient.invalidateQueries({
                    queryKey: [QUERY_KEYS.GET_ME],
                  })
                })()
              }}>
              <LogOutIcon className='size-5' aria-hidden />
              Sign Out
            </Button>
          ) : (
            <Button
              gap='md'
              onClick={() => {
                void signInWithGoogle()
              }}>
              <GoogleMark />
              Continue With Google
            </Button>
          )}
        </div>

        <div className='flex flex-col'>
          {user?.role === 'admin' && (
            <LinkRow
              to='/admin'
              icon={<ShieldIcon className='size-5' />}
              label='Admin'
            />
          )}
          <LinkRow
            to='/about'
            icon={<CircleQuestionMarkIcon className='size-5' />}
            label='About Synbox'
          />
          <button
            type='button'
            className={ROW}
            onClick={() => {
              setContact('open')
            }}>
            <span className='grid size-6 shrink-0 place-items-center text-muted-foreground'>
              <MailIcon className='size-5' />
            </span>
            <span className='min-w-0 flex-1 truncate text-foreground'>
              Contact Me
            </span>
          </button>
        </div>
        <p className='px-3 text-xs text-muted-foreground'>
          Version {__BUILD_ID__}
        </p>
      </div>
      <BoxScrollbar box={box} />
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
    </section>
  )
}

export default YouPage
