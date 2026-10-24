import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronRightIcon,
  CircleQuestionMarkIcon,
  UserIcon,
  LogOutIcon,
  ShieldIcon,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { GoogleMark } from '@/components/shared/google-mark'
import { UserAvatar } from '@/components/shared/user-avatar'
import { quotaText } from '@/components/topbar/profile-button'
import { Button } from '@/components/ui/button'
import { signInWithGoogle, signOut, useMe } from '@/lib/auth'
import { forgetMySongs } from '@/lib/offline/sync'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

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
  <Link
    to={to}
    className='flex min-h-12 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
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

// The installed app's You tab: the account and the app's own pages. The songs are in the Library tab
const YouPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const user = me?.user ?? null
  let accountLine =
    'Sign in to generate more songs and find them on every device.'
  if (user !== null) {
    accountLine = me?.quota ? quotaText(me.quota) : user.email
  }

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
                {user ? user.name : 'Not Signed In'}
              </p>
              <p className='text-sm text-pretty text-muted-foreground'>
                {accountLine}
              </p>
            </div>
          </div>
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
        </div>
        <p className='px-3 text-xs text-muted-foreground'>
          Version {__BUILD_ID__}
        </p>
      </div>
      <BoxScrollbar box={box} />
    </section>
  )
}

export default YouPage
