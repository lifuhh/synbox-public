import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'

import {
  RecommendButton,
  RecommendationsEditor,
} from '@/components/admin/recommendations-editor'
import { DocScroll } from '@/components/shared/doc-scroll'
import Forbidden from '@/components/shared/forbidden'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import {
  GUESTS,
  useAdminGenerations,
  useAdminReports,
  useAdminSettings,
  useAdminUsers,
  useSetBlocked,
  useSetGenerationEnabled,
  useSetDailyLimit,
} from '@/lib/admin-console'
import type {
  AdminGeneration,
  AdminReport,
  AdminUser,
  DailyLimit,
  SongsBy,
} from '@/lib/admin-console'
import { useAccess, useMe } from '@/lib/auth'
import { isStageId, overallAt, stepOf } from '@/lib/generation/plan'
import { useGetSongInfoBySongId } from '@/lib/react-query/queries-and-mutations'
import type { CssVars } from '@/types'
import { formatClock } from '@/utils'
import { cn } from '@/utils/cn'

const toDate = (value: string | number | null) => {
  if (value === null) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const fullDate = new Intl.DateTimeFormat([], {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const relative = new Intl.RelativeTimeFormat([], { numeric: 'auto' })

// Each unit in the one below it; past the last, years
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 24],
  ['day', 30],
  ['month', 12],
]

const ago = (date: Date) => {
  let amount = (date.getTime() - Date.now()) / 60_000
  if (Math.abs(amount) < 1) {
    return 'Just now'
  }
  for (const [unit, size] of UNITS) {
    if (Math.abs(amount) < size) {
      return relative.format(Math.round(amount), unit)
    }
    amount /= size
  }
  return relative.format(Math.round(amount), 'year')
}

// "5 minutes ago", with the exact time on hover
const When = ({ value }: { value: string | number | null }) => {
  const date = toDate(value)
  if (date === null) {
    return <span className='text-muted-foreground'>Never</span>
  }
  return (
    <time dateTime={date.toISOString()} title={fullDate.format(date)}>
      {ago(date)}
    </time>
  )
}

const Badge = ({
  children,
  tone,
}: {
  children: string
  tone: 'neutral' | 'error'
}) => (
  <span
    className={cn(
      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
      tone === 'neutral' && 'bg-accent text-foreground',
      tone === 'error' && 'bg-error/15 text-error'
    )}>
    {children}
  </span>
)

const Avatar = ({ user }: { user: AdminUser }) =>
  user.image !== null && user.image !== '' ? (
    <img
      src={user.image}
      alt=''
      referrerPolicy='no-referrer'
      className='size-8 shrink-0 rounded-full object-cover'
    />
  ) : (
    <span
      aria-hidden
      className='flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-foreground'>
      {(user.name.trim()[0] ?? user.email[0] ?? '?').toUpperCase()}
    </span>
  )

const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className='flex flex-col gap-1'>
    <span className='text-xs text-muted-foreground'>{label}</span>
    <span className='text-sm font-medium text-foreground tabular-nums'>
      {children}
    </span>
  </div>
)

const GenerationPanel = () => {
  const { data } = useAdminSettings()
  const { isPending, mutate: setEnabled } = useSetGenerationEnabled()
  const [confirming, setConfirming] = useState(false)
  if (data === undefined) {
    return <Skeleton className='h-20 w-full' />
  }
  const { generationEnabled, guestSongsToday, limits } = data
  return (
    <section className='flex flex-wrap items-center gap-x-10 gap-y-4 rounded-xl bg-card/60 p-4'>
      <Stat label='Generation'>
        <span className='flex items-center gap-2'>
          <span
            aria-hidden
            className={cn(
              'size-2 rounded-full',
              generationEnabled ? 'bg-success' : 'bg-warning'
            )}
          />
          {generationEnabled ? 'On' : 'Paused for Everyone'}
        </span>
      </Stat>
      <Stat label='Default User Limit'>{limits.user} a day</Stat>
      <Stat label='Guest Limit'>{limits.guest} a day per network</Stat>
      <Stat label='Guest Songs Today'>
        {guestSongsToday} of {limits.guestTotal}
      </Stat>
      <Button
        className='w-full sm:ml-auto sm:w-auto'
        variant={generationEnabled ? 'outline' : 'default'}
        disabled={isPending}
        onClick={() => {
          if (generationEnabled) {
            setConfirming(true)
          } else {
            setEnabled(true)
          }
        }}>
        {generationEnabled ? 'Pause Generation' : 'Resume Generation'}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause Generation for Everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              No one, admins included, can start a new song until you resume.
              Songs already running finish.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setEnabled(false)
              }}>
              Pause Generation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// The limit actually in force: admins and lifted limits have none
const effectiveLimit = (user: AdminUser, defaultLimit: number) => {
  if (user.role === 'admin' || user.dailyLimit === 'unlimited') {
    return null
  }
  return user.dailyLimit === 'default' ? defaultLimit : user.dailyLimit
}

// Songs in the last 24 hours against the limit, as a count and a thin bar
const Usage = ({ used, limit }: { used: number; limit: number | null }) => {
  if (limit === null) {
    return <span className='tabular-nums'>{used}</span>
  }
  const full = used >= limit
  const fill: CssVars = {
    '--fill': `${limit === 0 ? 100 : Math.min(100, (used / limit) * 100)}%`,
  }
  return (
    <div className='flex flex-col gap-1.5'>
      <span className='tabular-nums'>
        <span className={cn(full ? 'text-warning' : 'text-foreground')}>
          {used}
        </span>
        <span className='text-muted-foreground'> / {limit}</span>
      </span>
      <span className='h-1 w-full max-w-20 overflow-hidden rounded-full bg-accent'>
        <span
          className={cn(
            'block h-full w-(--fill) rounded-full',
            full ? 'bg-warning' : 'bg-primary'
          )}
          style={fill}
        />
      </span>
    </div>
  )
}

const limitLabel = (limit: DailyLimit, defaultLimit: number) => {
  if (limit === 'default') {
    return `Default (${defaultLimit})`
  }
  if (limit === 'unlimited') {
    return 'No Limit'
  }
  return limit === 0 ? 'None Allowed' : `${limit} a Day`
}

// One control for the three kinds of limit: the default, none, or a number typed in place
const LimitControl = ({
  user,
  defaultLimit,
}: {
  user: AdminUser
  defaultLimit: number
}) => {
  const { toast } = useToast()
  const { isPending, mutate, variables } = useSetDailyLimit()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Show the choice at once; the list refetches when the save settles
  const shown =
    isPending && variables !== undefined
      ? variables.dailyLimit
      : user.dailyLimit
  const save = (dailyLimit: DailyLimit) => {
    setEditing(false)
    if (dailyLimit === user.dailyLimit) {
      return
    }
    mutate(
      { dailyLimit, userId: user.id },
      {
        onError: () => {
          toast({
            description: `${user.name}'s limit is unchanged. Try again.`,
            title: 'Could Not Save the Limit',
            variant: 'destructive',
          })
        },
      }
    )
  }
  if (editing) {
    const commit = () => {
      const limit = Number(draft.trim())
      if (draft.trim() === '' || !Number.isInteger(limit) || limit < 0) {
        setEditing(false)
        return
      }
      save(limit)
    }
    return (
      <Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- it replaces the menu item the admin just chose
        autoFocus
        aria-label={`Songs a Day for ${user.name}`}
        inputMode='numeric'
        placeholder='Songs a day'
        value={draft}
        className='h-9 w-full'
        onChange={(event) => {
          setDraft(event.target.value.replaceAll(/\D/gu, ''))
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }
  const options: DailyLimit[] = ['default', 'unlimited']
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size='sm'
          variant='outline'
          gap='sm'
          aria-label={`Daily Limit for ${user.name}: ${limitLabel(shown, defaultLimit)}`}
          className='w-full justify-between'>
          <span
            className={cn(
              'truncate',
              shown === 'default' && 'text-muted-foreground'
            )}>
            {limitLabel(shown, defaultLimit)}
          </span>
          <ChevronDownIcon className='size-4 shrink-0 opacity-60' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-48'>
        {options.map((option) => (
          <DropdownMenuItem
            key={option}
            className='justify-between'
            onSelect={() => {
              save(option)
            }}>
            {limitLabel(option, defaultLimit)}
            {shown === option && <CheckIcon className='size-4' />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className='justify-between'
          onSelect={() => {
            setDraft(typeof shown === 'number' ? String(shown) : '')
            setEditing(true)
          }}>
          {typeof shown === 'number' ? 'Change Number…' : 'Set a Number…'}
          {typeof shown === 'number' && <CheckIcon className='size-4' />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Block sits behind a menu and a confirmation: it signs the person out everywhere
const RowActions = ({
  user,
  blocked,
}: {
  user: AdminUser
  blocked: boolean
}) => {
  const { toast } = useToast()
  const { isPending, mutate: setBlocked } = useSetBlocked()
  const [confirming, setConfirming] = useState(false)
  const run = (next: boolean) => {
    setBlocked(
      { blocked: next, userId: user.id },
      {
        onError: (error) => {
          toast({
            description: error.message,
            title: next ? 'Could Not Block' : 'Could Not Unblock',
            variant: 'destructive',
          })
        },
      }
    )
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size='icon'
            variant='ghost'
            disabled={isPending}
            aria-label={`Actions for ${user.name}`}>
            <EllipsisIcon className='size-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-40'>
          {blocked ? (
            <DropdownMenuItem
              onSelect={() => {
                run(false)
              }}>
              Unblock
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant='destructive'
              onSelect={() => {
                setConfirming(true)
              }}>
              Block…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {user.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {user.email} is signed out everywhere and can&apos;t generate
              songs. You can unblock them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                run(true)
              }}>
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface AccountProps {
  user: AdminUser
  isSelf: boolean
  defaultLimit: number
}

const isBlocked = (user: AdminUser) => user.banned === 1 || user.banned === true

const Account = ({ user, isSelf }: AccountProps) => (
  <div
    className={cn(
      'flex min-w-0 items-center gap-3',
      isBlocked(user) && 'opacity-60'
    )}>
    <Avatar user={user} />
    <div className='min-w-0'>
      <div className='flex items-center gap-2'>
        <span className='truncate font-medium text-foreground'>
          {user.name}
        </span>
        {user.role === 'admin' && <Badge tone='neutral'>Admin</Badge>}
        {isBlocked(user) && <Badge tone='error'>Blocked</Badge>}
        {isSelf && (
          <span className='shrink-0 text-xs text-muted-foreground'>You</span>
        )}
      </div>
      <span className='block truncate text-xs text-muted-foreground'>
        {user.email}
      </span>
    </div>
  </div>
)

// A blocked person can't generate at all, so their usage is shown without a limit to measure against
const AccountUsage = ({ user, defaultLimit }: AccountProps) => (
  <Usage
    used={user.songsLastDay}
    limit={isBlocked(user) ? null : effectiveLimit(user, defaultLimit)}
  />
)

const AccountLimit = ({ user, defaultLimit }: AccountProps) =>
  user.role === 'admin' ? (
    <span className='text-sm text-muted-foreground'>No Limit</span>
  ) : (
    <LimitControl user={user} defaultLimit={defaultLimit} />
  )

const AccountActions = ({ user, isSelf }: AccountProps) =>
  isSelf || user.role === 'admin' ? null : (
    <RowActions user={user} blocked={isBlocked(user)} />
  )

const UserRow = (props: AccountProps) => (
  <tr className='h-16 border-t border-border align-middle'>
    <th scope='row' className='pr-4 text-left font-normal'>
      <Account {...props} />
    </th>
    <td className='px-4 text-muted-foreground'>
      <When value={props.user.lastSeenAt} />
    </td>
    <td className='px-4'>
      <AccountUsage {...props} />
    </td>
    <td className='px-4 text-right tabular-nums'>{props.user.songsTotal}</td>
    <td className='px-4'>
      <AccountLimit {...props} />
    </td>
    <td className='pl-2 text-right'>
      <AccountActions {...props} />
    </td>
  </tr>
)

// Phones: the same account as a stacked card, since six columns don't fit
const UserCard = (props: AccountProps) => (
  <li className='flex flex-col gap-3 border-t border-border py-4'>
    <div className='flex items-center justify-between gap-2'>
      <Account {...props} />
      <AccountActions {...props} />
    </div>
    <p className='text-xs text-muted-foreground'>
      Seen <When value={props.user.lastSeenAt} /> ·{' '}
      <span className='tabular-nums'>{props.user.songsTotal}</span> songs in
      total
    </p>
    <div className='grid grid-cols-2 items-start gap-4'>
      <div className='flex flex-col gap-1'>
        <span className='text-xs text-muted-foreground'>Last 24 Hours</span>
        <AccountUsage {...props} />
      </div>
      <div className='flex flex-col gap-1'>
        <span className='text-xs text-muted-foreground'>Daily Limit</span>
        <AccountLimit {...props} />
      </div>
    </div>
  </li>
)

const UsersTable = () => {
  const { data: users, error } = useAdminUsers()
  const { data: settings } = useAdminSettings()
  const { data: me } = useMe()
  if (error !== null) {
    return <p className='text-sm text-error'>{error.message}</p>
  }
  if (users === undefined || settings === undefined) {
    return <Skeleton className='h-40 w-full' />
  }
  if (users.length === 0) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        No one has signed in yet.
      </p>
    )
  }
  const rows = users.map((user) => ({
    defaultLimit: settings.limits.user,
    isSelf: user.id === me?.user?.id,
    user,
  }))
  return (
    <>
      <ul className='text-sm md:hidden'>
        {rows.map((row) => (
          <UserCard key={row.user.id} {...row} />
        ))}
      </ul>
      {/* Fixed columns, so every row lines up whatever its content */}
      <table className='hidden w-full table-fixed text-left text-sm md:table'>
        <colgroup>
          <col />
          <col className='w-36' />
          <col className='w-28' />
          <col className='w-28' />
          <col className='w-44' />
          <col className='w-14' />
        </colgroup>
        <thead className='text-xs text-muted-foreground'>
          <tr>
            <th className='pr-4 pb-2 font-medium'>Account</th>
            <th className='px-4 pb-2 font-medium'>Last Seen</th>
            <th className='px-4 pb-2 font-medium'>Last 24 Hours</th>
            <th className='px-4 pb-2 text-right font-medium whitespace-nowrap'>
              Total Songs
            </th>
            <th className='px-4 pb-2 font-medium'>Daily Limit</th>
            <th className='pb-2 pl-2 font-medium'>
              <span className='sr-only'>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <UserRow key={row.user.id} {...row} />
          ))}
        </tbody>
      </table>
    </>
  )
}

const KIND_LABELS = {
  new: 'New',
  regenerate: 'Regenerate',
  retime: 'Retime',
} as const

// A running song shows its step and how far the whole job is, as the progress panel does; one the backend
// stopped reporting on was let go ('abandoned') and shows as stopped
// A running song's step and how far along it is, or where the song ended up
const statusOf = (
  generation: AdminGeneration
): { label: string; percent?: number } => {
  if (generation.status === 'succeeded') {
    return { label: 'Done' }
  }
  if (generation.status === 'failed') {
    return {
      label: generation.errorCode === 'abandoned' ? 'Stopped' : 'Failed',
    }
  }
  const { stage, fraction } = generation
  if (!isStageId(stage)) {
    return { label: 'Starting' }
  }
  return {
    label: stepOf(stage)?.title ?? 'In Progress',
    percent: Math.round(overallAt(stage, fraction ?? 0) * 100),
  }
}

const statusLabel = (generation: AdminGeneration) => {
  const { label, percent } = statusOf(generation)
  return percent === undefined ? label : `${label} · ${percent}%`
}

// The table's cell: the step on one line, its percent under it
const StatusCell = ({ generation }: { generation: AdminGeneration }) => {
  const { label, percent } = statusOf(generation)
  return (
    <>
      <span className='block truncate'>{label}</span>
      {percent !== undefined && (
        <span className='block text-xs text-muted-foreground tabular-nums'>
          {percent}%
        </span>
      )}
    </>
  )
}

const statusClass = (generation: AdminGeneration) =>
  cn(
    generation.status === 'failed' &&
      (generation.errorCode === 'abandoned'
        ? 'text-muted-foreground'
        : 'text-error'),
    generation.status === 'succeeded' && 'text-foreground',
    (generation.status === 'reserved' || generation.status === 'running') &&
      'text-muted-foreground tabular-nums'
  )

const isGuest = (generation: Pick<AdminGeneration, 'guest'>) =>
  generation.guest === 1 || generation.guest === true

const requester = (generation: AdminGeneration) =>
  isGuest(generation) ? 'Guest' : (generation.name ?? 'Deleted Account')

// Narrows the Songs list to whoever asked for this song
const ByLink = ({ generation }: { generation: AdminGeneration }) => {
  const by = isGuest(generation) ? GUESTS : generation.email
  return by === null ? (
    requester(generation)
  ) : (
    <Link
      to={`?tab=songs&user=${encodeURIComponent(by)}`}
      className='hover:underline'>
      {requester(generation)}
    </Link>
  )
}

const SongTitle = ({ generation }: { generation: AdminGeneration }) => {
  const { data: songInfo } = useGetSongInfoBySongId(generation.videoId)
  const path = `/v/${generation.videoId}`
  // The title and its address are one link, so a tap anywhere on either opens the song
  return (
    <Link
      to={path}
      className='group block min-w-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      <span className='block truncate font-medium text-foreground group-hover:underline'>
        {songInfo?.title ?? generation.videoId}
      </span>
      <span className='block truncate text-xs text-muted-foreground group-hover:underline'>
        synbox.io{path}
      </span>
    </Link>
  )
}

const SongRow = ({ generation }: { generation: AdminGeneration }) => (
  <tr className='h-14 border-t border-border align-middle'>
    <th scope='row' className='pr-4 text-left font-normal'>
      <SongTitle generation={generation} />
    </th>
    <td className='px-4'>
      <span className='block truncate'>
        <ByLink generation={generation} />
      </span>
      {!isGuest(generation) && generation.email !== null && (
        <span className='block truncate text-xs text-muted-foreground'>
          {generation.email}
        </span>
      )}
    </td>
    <td className='px-4'>{KIND_LABELS[generation.kind]}</td>
    <td className={cn('px-4', statusClass(generation))}>
      <StatusCell generation={generation} />
    </td>
    <td className='truncate pl-4 text-muted-foreground'>
      <When value={generation.createdAt} />
    </td>
    <td className='pl-2 text-right'>
      {generation.status === 'succeeded' && (
        <RecommendButton videoId={generation.videoId} />
      )}
    </td>
  </tr>
)

// Phones: the song on one line, and who, what and when under it
const SongCard = ({ generation }: { generation: AdminGeneration }) => (
  <li className='flex flex-col gap-1.5 border-t border-border py-3'>
    <div className='flex items-start justify-between gap-3'>
      <div className='min-w-0'>
        <SongTitle generation={generation} />
      </div>
      <span className='flex shrink-0 items-center gap-1'>
        <span className={statusClass(generation)}>
          {statusLabel(generation)}
        </span>
        {generation.status === 'succeeded' && (
          <RecommendButton videoId={generation.videoId} />
        )}
      </span>
    </div>
    <p className='truncate text-xs text-muted-foreground'>
      {KIND_LABELS[generation.kind]} by <ByLink generation={generation} /> ·{' '}
      <When value={generation.createdAt} />
    </p>
  </li>
)

const SONGS_PER_PAGE = 20

// Everyone, guests, then each account, most songs first. An email no account has (a deleted one, a hand-typed
// link) still shows as itself, so the field never claims Everyone while the list is narrowed
const SongsFilter = ({
  by,
  onChange,
}: {
  by: SongsBy
  onChange: (by: SongsBy) => void
}) => {
  const { data: users = [] } = useAdminUsers()
  const accounts = users.toSorted(
    (a, b) => b.songsTotal - a.songsTotal || a.name.localeCompare(b.name)
  )
  const unknown =
    by !== null && by !== GUESTS && !accounts.some(({ email }) => email === by)
  return (
    <label className='flex items-center gap-2 self-start text-sm text-muted-foreground'>
      By
      <select
        value={by ?? ''}
        onChange={(event) => {
          onChange(event.target.value === '' ? null : event.target.value)
        }}
        className='h-9 max-w-[min(20rem,calc(100vw-5rem))] truncate rounded-full border border-border bg-card px-3 text-foreground'>
        <option value=''>Everyone</option>
        <option value={GUESTS}>Guests</option>
        {unknown && <option value={by}>{by}</option>}
        {accounts.map((user) => (
          <option key={user.id} value={user.email}>
            {user.name} · {user.email}
          </option>
        ))}
      </select>
    </label>
  )
}

// The latest 200 songs generated since accounts arrived, everyone's or one requester's, newest first, a page at
// a time
const SongsTable = ({ by }: { by: SongsBy }) => {
  const { data: generations, error } = useAdminGenerations(by)
  const [page, setPage] = useState(0)
  if (error !== null) {
    return <p className='text-sm text-error'>{error.message}</p>
  }
  if (generations === undefined) {
    return <Skeleton className='h-40 w-full' />
  }
  if (generations.length === 0) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        {by === null ? 'No songs generated yet.' : 'No songs.'}
      </p>
    )
  }
  const pages = Math.ceil(generations.length / SONGS_PER_PAGE)
  // A shorter list (a refresh) never leaves the page past its end
  const shown = Math.min(page, pages - 1)
  const first = shown * SONGS_PER_PAGE
  const rows = generations.slice(first, first + SONGS_PER_PAGE)
  return (
    <>
      <ul className='text-sm md:hidden'>
        {rows.map((generation) => (
          <SongCard key={generation.id} generation={generation} />
        ))}
      </ul>
      <table className='hidden w-full table-fixed text-left text-sm md:table'>
        <colgroup>
          <col />
          <col className='w-56' />
          <col className='w-28' />
          <col className='w-48' />
          <col className='w-36' />
          <col className='w-12' />
        </colgroup>
        <thead className='text-xs text-muted-foreground'>
          <tr>
            <th className='pr-4 pb-2 font-medium'>Song</th>
            <th className='px-4 pb-2 font-medium'>By</th>
            <th className='px-4 pb-2 font-medium'>Kind</th>
            <th className='px-4 pb-2 font-medium'>Status</th>
            <th className='pb-2 pl-4 font-medium'>When</th>
            <th className='pb-2 pl-2 font-medium'>
              <span className='sr-only'>Recommend</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((generation) => (
            <SongRow key={generation.id} generation={generation} />
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <nav
          aria-label='Songs Pages'
          className='flex items-center justify-end gap-2 border-t border-border pt-3 text-sm text-muted-foreground'>
          <span className='mr-auto tabular-nums'>
            {first + 1}–{first + rows.length} of {generations.length}
          </span>
          <Button
            variant='row-icon'
            size='icon'
            aria-label='Previous Page'
            disabled={shown === 0}
            onClick={() => {
              setPage(shown - 1)
            }}>
            <ChevronLeftIcon className='size-4' />
          </Button>
          <span className='tabular-nums'>
            {shown + 1} / {pages}
          </span>
          <Button
            variant='row-icon'
            size='icon'
            aria-label='Next Page'
            disabled={shown === pages - 1}
            onClick={() => {
              setPage(shown + 1)
            }}>
            <ChevronRightIcon className='size-4' />
          </Button>
        </nav>
      )}
    </>
  )
}

// The device and browser a report came from, from its user agent: many lyric bugs are one engine's
const DEVICES: [string, RegExp][] = [
  ['iPhone', /iPhone/u],
  ['iPad', /iPad/u],
  ['Android', /Android/u],
  ['Mac', /Macintosh/u],
  ['Windows', /Windows/u],
]
// Chrome's agent names Safari too, so Chrome is asked first
const BROWSERS: [string, RegExp][] = [
  ['Firefox', /Firefox\//u],
  ['Chrome', /Chrome\/|CriOS\//u],
  ['Safari', /Safari\//u],
]
const clientLabel = (client: string | null) => {
  const match = (list: [string, RegExp][]) =>
    list.find(([, pattern]) => pattern.test(client ?? ''))?.[0]
  return [match(DEVICES), match(BROWSERS)].filter(Boolean).join(' ') || null
}

const ReportItem = ({ report }: { report: AdminReport }) => {
  const { data: songInfo } = useGetSongInfoBySongId(report.videoId)
  const by = isGuest(report) ? 'Guest' : (report.name ?? 'Deleted Account')
  const where = [
    report.atSeconds === null ? null : formatClock(report.atSeconds),
    report.version === null ? null : `Version ${report.version}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className='flex flex-col gap-1.5 border-t border-border py-3'>
      <div className='flex items-baseline justify-between gap-3'>
        <Link
          to={`/v/${report.videoId}`}
          className='min-w-0 truncate font-medium text-foreground hover:underline'>
          {songInfo?.title ?? report.videoId}
        </Link>
        <span className='shrink-0 text-muted-foreground tabular-nums'>
          {where}
        </span>
      </div>
      <p className='text-pretty whitespace-pre-wrap text-foreground'>
        {report.message}
      </p>
      <p className='truncate text-xs text-muted-foreground'>
        {[by, clientLabel(report.client)].filter(Boolean).join(' · ')} ·{' '}
        <When value={report.createdAt} />
      </p>
    </li>
  )
}

// What listeners reported, newest first: the song, where in it, and what was wrong
const ReportsList = () => {
  const { data: reports, error } = useAdminReports()
  if (error !== null) {
    return <p className='text-sm text-error'>{error.message}</p>
  }
  if (reports === undefined) {
    return <Skeleton className='h-40 w-full' />
  }
  if (reports.length === 0) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        No reports yet.
      </p>
    )
  }
  return (
    <ul className='text-sm'>
      {reports.map((report) => (
        <ReportItem key={report.id} report={report} />
      ))}
    </ul>
  )
}

const TABS = ['songs', 'reports', 'recommendations', 'accounts'] as const
type Tab = (typeof TABS)[number]
const isTab = (value: string | null): value is Tab =>
  TABS.some((tab) => tab === value)

// One list at a time, each of which can run long. The tab and the Songs filter live in the address, so a
// reload, a shared link or a requester's name (ByLink) lands on the same view
const AdminTabs = () => {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab = isTab(tabParam) ? tabParam : 'songs'
  const by = params.get('user')
  const show = (next: Tab, user: SongsBy = null) => {
    setParams(user === null ? { tab: next } : { tab: next, user }, {
      replace: true,
    })
  }
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (isTab(value)) {
          show(value)
        }
      }}>
      {/* Scrolls sideways on a phone too narrow for all four */}
      <div className='-mx-1 no-scrollbar overflow-x-auto px-1'>
        <TabsList className='justify-start touch:h-13'>
          <TabsTrigger value='songs' className='h-full'>
            Songs
          </TabsTrigger>
          <TabsTrigger value='reports' className='h-full'>
            Reports
          </TabsTrigger>
          <TabsTrigger value='recommendations' className='h-full'>
            Recommendations
          </TabsTrigger>
          <TabsTrigger value='accounts' className='h-full'>
            Accounts
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value='songs' className='mt-4'>
        <div className='flex flex-col gap-3'>
          <SongsFilter
            by={by}
            onChange={(user) => {
              show('songs', user)
            }}
          />
          {/* Keyed by the filter, so a new filter starts on its first page */}
          <SongsTable key={by ?? ''} by={by} />
        </div>
      </TabsContent>
      <TabsContent value='reports' className='mt-4'>
        <ReportsList />
      </TabsContent>
      <TabsContent value='recommendations' className='mt-4'>
        <div className='flex flex-col gap-3'>
          <p className='text-sm text-muted-foreground'>
            The landing page&apos;s carousel, shuffled for each visitor. The mic
            marks songs that have karaoke lyrics.
          </p>
          <RecommendationsEditor />
        </div>
      </TabsContent>
      <TabsContent value='accounts' className='mt-4'>
        <div className='flex flex-col gap-3'>
          <p className='text-sm text-muted-foreground'>
            Everyone who has signed in, most recently seen first.
          </p>
          <UsersTable />
        </div>
      </TabsContent>
    </Tabs>
  )
}

// Admins only: anyone else gets a 403, once the sign-in check has answered
const AdminPage = () => {
  const { admin, ready } = useAccess()
  if (!ready) {
    return null
  }
  if (!admin) {
    return <Forbidden />
  }
  return (
    <div className='mx-auto flex w-full max-w-5xl flex-col gap-8 overflow-y-auto pt-page-top page-x-tight pb-page-bottom-lg doc-scroll:overflow-visible'>
      <title>Admin · Synbox</title>
      <DocScroll />
      <h1 className='text-2xl font-bold text-foreground'>Admin</h1>
      <GenerationPanel />
      <AdminTabs />
    </div>
  )
}

export default AdminPage
