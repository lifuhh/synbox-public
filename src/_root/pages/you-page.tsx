import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import {
  ChevronRightIcon,
  CircleQuestionMarkIcon,
  UserIcon,
  ListMusicIcon,
  LogInIcon,
  LogOutIcon,
  ShieldIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { UserAvatar } from '@/components/shared/user-avatar'
import { quotaText } from '@/components/topbar/profile-button'
import { Button } from '@/components/ui/button'
import { SongRow } from '@/components/watch/song-row'
import { signInWithGoogle, signOut, useMe } from '@/lib/auth'
import { favoritesAtom, historyAtom } from '@/lib/library/store'
import { usePlaylists } from '@/lib/listening/store'
import { forgetMySongs } from '@/lib/offline/sync'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

const HISTORY_SHOWN = 10

const Section = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => (
  <section className='flex flex-col gap-1'>
    <h2 className='px-2 text-lg font-semibold text-foreground'>{title}</h2>
    {children}
  </section>
)

// A row that opens a page: its icon, its label, a chevron
const LinkRow = ({
  to,
  icon,
  label,
  detail,
  external = false,
}: {
  to: string
  icon: ReactNode
  label: string
  detail?: string
  external?: boolean
}) => {
  const className =
    'flex min-h-12 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'
  const body = (
    <>
      <span className='grid size-6 shrink-0 place-items-center text-muted-foreground'>
        {icon}
      </span>
      <span className='min-w-0 flex-1 truncate text-foreground'>{label}</span>
      {detail !== undefined && (
        <span className='text-sm text-muted-foreground tabular-nums'>
          {detail}
        </span>
      )}
      <ChevronRightIcon
        className='size-5 shrink-0 text-muted-foreground'
        aria-hidden
      />
    </>
  )
  return external ? (
    <a href={to} target='_blank' rel='noreferrer' className={className}>
      {body}
    </a>
  ) : (
    <Link to={to} className={className}>
      {body}
    </Link>
  )
}

// The installed app's You tab: the account, playlists, bookmarks and history, and the app's own pages
const YouPage = () => {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const user = me?.user ?? null
  const playlists = usePlaylists()
  const favorites = useAtomValue(favoritesAtom)
  const history = useAtomValue(historyAtom)
  let accountLine =
    'Sign in to generate more songs and find them on every device.'
  if (user !== null) {
    accountLine = me?.quota ? quotaText(me.quota) : user.email
  }

  return (
    <section
      data-scroll-top
      className='flex flex-1 flex-col overflow-y-auto px-4 pt-(--topbar-h) pb-page-bottom'>
      <title>You | Synbox</title>
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
              <LogInIcon className='size-5' aria-hidden />
              Continue With Google
            </Button>
          )}
        </div>

        <LinkRow
          to='/playlists'
          icon={<ListMusicIcon className='size-5' />}
          label='Playlists'
          detail={String(playlists.length)}
        />

        {favorites.length > 0 && (
          <Section title='Bookmarks'>
            <ul className='flex flex-col'>
              {favorites.toReversed().map((song) => (
                <SongRow key={song.videoId} song={song} />
              ))}
            </ul>
          </Section>
        )}

        {history.length > 0 && (
          <Section title='History'>
            <ul className='flex flex-col'>
              {history.slice(0, HISTORY_SHOWN).map((song) => (
                <SongRow key={song.videoId} song={song} />
              ))}
            </ul>
          </Section>
        )}

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
    </section>
  )
}

export default YouPage
