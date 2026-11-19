import { useQuery } from '@tanstack/react-query'
import {
  BanIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  Trash2Icon,
  Undo2Icon,
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
import { offerUndo } from '@/components/shared/offer-undo'
import { SearchField } from '@/components/shared/search-field'
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
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { wheelSideways } from '@/hooks/wheel-sideways'
import {
  AdminOutdatedError,
  GUESTS,
  REPORTS_LIMIT,
  MANUAL_DROP_REASONS,
  DROP_REASONS,
  dropReasonLabel,
  feedbackState,
  reportState,
  useAdminFeedback,
  useAdminGenerations,
  useChangeFeedback,
  useAdminMessages,
  useAdminRequests,
  useDecideRequest,
  useAdminReports,
  useAdminSettings,
  useAdminSignals,
  useAdminUsage,
  useAdminUsers,
  useSetBlocked,
  useSetGenerationEnabled,
  useSetDailyLimit,
  useChangeReport,
  useClearDropped,
  useDeleteRow,
  useFixedVersions,
  useRestoreDeleted,
} from '@/lib/admin-console'
import type {
  AdminFeedback,
  AdminGeneration,
  FeedbackChange,
  AdminMessage,
  AdminRequest,
  AdminReport,
  ReportChange,
  ReportState,
  AdminUser,
  DailyLimit,
  Deletable,
  DeletableKind,
  SignalFlag,
  SongsBy,
} from '@/lib/admin-console'
import { SONGS_A_DAY, useAccess, useMe } from '@/lib/auth'
import { isStageId, overallAt, stepOf } from '@/lib/generation/plan'
import { applyWaitingUpdate } from '@/lib/pwa'
import {
  librarySongs,
  useGetSongInfoBySongId,
} from '@/lib/react-query/queries-and-mutations'
import type { LibraryListSong } from '@/lib/synbox-flask/discovery'
import { matchesQuery } from '@/lib/text-search'
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

const clockTime = new Intl.DateTimeFormat([], { timeStyle: 'short' })

// The time today, the date and time before today
const sameDayTime = (date: Date) =>
  (date.toDateString() === new Date().toDateString()
    ? clockTime
    : fullDate
  ).format(date)

// When the site's ceiling paused generation
const PausedAt = ({ at }: { at: number }) => {
  const date = new Date(at)
  return (
    <time dateTime={date.toISOString()} title={fullDate.format(date)}>
      {sameDayTime(date)}
    </time>
  )
}

const GenerationStatus = ({
  enabled,
  autoPause,
}: {
  enabled: boolean
  autoPause: { at: number; count: number } | null | undefined
}) => {
  if (enabled) {
    return 'On'
  }
  if (autoPause === null || autoPause === undefined) {
    return 'Paused for Everyone'
  }
  return (
    <>
      Paused Automatically · {autoPause.count}{' '}
      {autoPause.count === 1 ? 'Song' : 'Songs'} ·{' '}
      <PausedAt at={autoPause.at} />
    </>
  )
}

const GenerationPanel = () => {
  const { data } = useAdminSettings()
  const { isPending, mutate: setEnabled } = useSetGenerationEnabled()
  const [confirming, setConfirming] = useState(false)
  if (data === undefined) {
    return <Skeleton className='h-20 w-full' />
  }
  const { autoPause, generationEnabled, limits } = data
  return (
    <section className='flex flex-wrap items-center gap-x-10 gap-y-4 rounded-xl bg-card/60 p-4'>
      <Stat label='Generation'>
        <span className='flex items-center gap-2'>
          <span
            aria-hidden
            className={cn(
              'size-2 shrink-0 rounded-full',
              generationEnabled ? 'bg-success' : 'bg-warning'
            )}
          />
          <span>
            <GenerationStatus
              enabled={generationEnabled}
              autoPause={autoPause}
            />
          </span>
        </span>
      </Stat>
      <Stat label='Songs a Day per Account'>{limits.user}</Stat>
      {limits.site === undefined ? null : (
        <Stat label='Songs a Day Site-Wide'>{limits.site}</Stat>
      )}
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
              Songs already running finish
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
            description: `${user.name}'s limit is unchanged. Try again`,
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
        placeholder={String(SONGS_A_DAY)}
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
              songs. You can unblock them later
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

// Counted plays (every visit to a song), with the last one under the count
const Plays = ({ user }: { user: AdminUser }) => (
  <div className='flex flex-col'>
    <span className='tabular-nums'>{user.plays}</span>
    <span className='text-xs text-muted-foreground'>
      <When value={user.lastPlayAt} />
    </span>
  </div>
)

const UserRow = (props: AccountProps) => (
  <tr className='h-16 border-t border-border align-middle'>
    <th scope='row' className='pr-4 text-left font-normal'>
      <Account {...props} />
    </th>
    <td className='px-4 text-muted-foreground'>
      <When value={props.user.lastActiveAt} />
    </td>
    <td className='px-4'>
      <Plays user={props.user} />
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
      Active <When value={props.user.lastActiveAt} /> ·{' '}
      <span className='tabular-nums'>{props.user.plays}</span> plays, last{' '}
      <When value={props.user.lastPlayAt} /> ·{' '}
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

const LoadError = ({ error }: { error: Error }) =>
  error instanceof AdminOutdatedError ? (
    <p className='flex items-center gap-3 text-sm text-error'>
      Page Out of Date
      <Button
        onClick={() => {
          if (!applyWaitingUpdate()) {
            window.location.reload()
          }
        }}
        size='sm'
        variant='outline'>
        Reload
      </Button>
    </p>
  ) : (
    <p className='text-sm text-error'>{error.message}</p>
  )

// A list's search, in the address as `q` beside `tab`, so a reload or a shared link keeps it. Another tab starts
// without one
const useListQuery = () => {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const setQuery = (next: string) => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === '') {
          updated.delete('q')
        } else {
          updated.set('q', next)
        }
        return updated
      },
      { replace: true }
    )
  }
  return { query, searching: query.trim() !== '', setQuery }
}

// What a search hid everything in; a status, so a screen reader hears it as the list empties
const NoMatches = () => (
  <output className='block py-6 text-center text-sm text-muted-foreground'>
    No matches
  </output>
)

// Closed lists (resolved and dropped reports, settled inbox items) show this many, then this many more a press
const PAGE = 20

const ShowMore = ({ onClick }: { onClick: () => void }) => (
  <Button variant='quiet' size='text' className='self-center' onClick={onClick}>
    Show More
  </Button>
)

const titleOf = (songs: LibraryListSong[]) =>
  new Map(songs.map((song) => [song.videoId, `${song.title} ${song.author}`]))

// Song titles to search by, from the library list the app loads anyway (a row draws its own title, a song at a
// time); only once something is typed. A song not in the library is found by its video id
const useSongTitles = (searching: boolean) =>
  useQuery({ ...librarySongs, enabled: searching, select: titleOf }).data ??
  new Map<string, string>()

const UsersTable = ({ query }: { query: string }) => {
  const { data: users, error } = useAdminUsers()
  const { data: settings } = useAdminSettings()
  const { data: me } = useMe()
  if (error !== null) {
    return <LoadError error={error} />
  }
  if (users === undefined || settings === undefined) {
    return <Skeleton className='h-40 w-full' />
  }
  if (users.length === 0) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        No one has signed in yet
      </p>
    )
  }
  const found = users.filter((user) =>
    matchesQuery(query, [user.name, user.email, user.id])
  )
  if (found.length === 0) {
    return <NoMatches />
  }
  const rows = found.map((user) => ({
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
          <col className='w-28' />
          <col className='w-44' />
          <col className='w-14' />
        </colgroup>
        <thead className='text-xs text-muted-foreground'>
          <tr>
            <th className='pr-4 pb-2 font-medium'>Account</th>
            <th className='px-4 pb-2 font-medium'>Last Active</th>
            <th className='px-4 pb-2 font-medium'>Plays</th>
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

// Failures that are not faults, by the backend's errorCode: one it stopped reporting on was let go, and a
// video that isn't a Japanese song was turned away. Any other code is the exception's name
const QUIET_ENDS: Record<string, string> = {
  NotAJapaneseSong: 'Not a Japanese Song',
  abandoned: 'Stopped',
}

const quietEnd = (generation: AdminGeneration) =>
  generation.status === 'failed' && generation.errorCode !== null
    ? QUIET_ENDS[generation.errorCode]
    : undefined

// A running song's step and how far the whole job is, as the progress panel does, or where the song ended
// up; a failure names its cause under the label
const statusOf = (
  generation: AdminGeneration
): { label: string; percent?: number; cause?: string } => {
  if (generation.status === 'succeeded') {
    return { label: 'Done' }
  }
  if (generation.status === 'failed') {
    const quiet = quietEnd(generation)
    return quiet === undefined
      ? { cause: generation.errorCode ?? undefined, label: 'Failed' }
      : { label: quiet }
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

// The table's cell: the step on one line, its percent or a failure's cause under it
const StatusCell = ({ generation }: { generation: AdminGeneration }) => {
  const { label, percent, cause } = statusOf(generation)
  return (
    <>
      <span className='block truncate'>{label}</span>
      {percent !== undefined && (
        <span className='block text-xs text-muted-foreground tabular-nums'>
          {percent}%
        </span>
      )}
      {cause !== undefined && (
        <span
          className='block truncate text-xs text-muted-foreground'
          title={cause}>
          {cause}
        </span>
      )}
    </>
  )
}

const statusClass = (generation: AdminGeneration) =>
  cn(
    generation.status === 'failed' &&
      (quietEnd(generation) === undefined
        ? 'text-error'
        : 'text-muted-foreground'),
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
    <Link to={path} className='group block min-w-0 rounded-sm'>
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
    <label className='flex items-center gap-2 text-sm text-muted-foreground'>
      By
      <Select
        value={by ?? ''}
        onChange={(event) => {
          onChange(event.target.value === '' ? null : event.target.value)
        }}
        className='max-w-[min(20rem,calc(100vw-5rem))]'>
        <option value=''>Everyone</option>
        <option value={GUESTS}>Guests</option>
        {unknown && <option value={by}>{by}</option>}
        {accounts.map((user) => (
          <option key={user.id} value={user.email}>
            {user.name} · {user.email}
          </option>
        ))}
      </Select>
    </label>
  )
}

// The latest 200 songs generated since accounts arrived, everyone's or one requester's, newest first, a page at
// a time
const SongsTable = ({ by, query }: { by: SongsBy; query: string }) => {
  const { data: loaded, error } = useAdminGenerations(by)
  const titles = useSongTitles(query.trim() !== '')
  const [page, setPage] = useState(0)
  if (error !== null) {
    return <LoadError error={error} />
  }
  if (loaded === undefined) {
    return <Skeleton className='h-40 w-full' />
  }
  if (loaded.length === 0) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        {by === null ? 'No songs generated yet' : 'No songs'}
      </p>
    )
  }
  const generations = loaded.filter((generation) =>
    matchesQuery(query, [
      titles.get(generation.videoId),
      generation.videoId,
      requester(generation),
      generation.email,
    ])
  )
  if (generations.length === 0) {
    return <NoMatches />
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

// Every report action is one press and undone by Reopen, so none asks first
const ROW_BUTTON =
  'relative shrink-0 touch:after:absolute touch:after:inset-x-0 touch:after:-inset-y-2'

const DELETED_TITLES = {
  feedback: 'Feedback Deleted',
  message: 'Message Deleted',
  report: 'Report Deleted',
} as const

// Runs a delete, then offers its Undo, or says it failed. Awaited rather than mutate's callbacks: the button that
// started it is gone once the list refreshes without its row, and a gone button's callbacks never run
const useDeleteWithUndo = () => {
  const { toast } = useToast()
  const failed = (title: string) => (error: Error) => {
    toast({ description: error.message, title, variant: 'destructive' })
  }
  const restore = useRestoreDeleted(failed('Could Not Undo'))
  return async (
    title: string,
    kind: DeletableKind,
    run: () => Promise<readonly (string | number)[]>
  ) => {
    try {
      const ids = await run()
      offerUndo(
        title,
        ids.length === 0
          ? null
          : () => {
              void restore(kind, ids)
            }
      )
    } catch (error) {
      failed('Could Not Delete')(
        error instanceof Error ? error : new Error('Delete failed')
      )
    }
  }
}

// A row's Delete: one press, then an Undo toast that brings it back (the delete is soft: worker/src/deleted.ts)
const DeleteButton = ({ row }: { row: Deletable }) => {
  const { isPending, mutateAsync } = useDeleteRow()
  const deleteWithUndo = useDeleteWithUndo()
  return (
    <Button
      size='row'
      variant='outline'
      disabled={isPending}
      className={ROW_BUTTON}
      onClick={() => {
        void deleteWithUndo(DELETED_TITLES[row.kind], row.kind, async () => {
          await mutateAsync(row)
          return [row.id]
        })
      }}>
      <Trash2Icon className='size-3.5' />
      Delete
    </Button>
  )
}

const ReportAction = ({ report }: { report: AdminReport }) => {
  const { toast } = useToast()
  const { isPending, mutate } = useChangeReport()
  const state = reportState(report)
  const change = (next: ReportChange, failure: string) => {
    mutate(
      { change: next, report },
      {
        onError: (error) => {
          toast({
            description: error.message,
            title: failure,
            variant: 'destructive',
          })
        },
      }
    )
  }
  if (state === 'resolved' || state === 'dropped') {
    const status = [
      state === 'resolved' ? 'Resolved' : 'Dropped',
      state === 'resolved' && typeof report.resolvedVersion === 'number'
        ? `v${report.resolvedVersion}`
        : null,
      state === 'dropped' ? dropReasonLabel(report.dropReason) : null,
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <div className='ml-auto flex shrink-0 items-center gap-2'>
        <span
          className={cn(
            'text-xs whitespace-nowrap',
            state === 'resolved' ? 'text-success' : 'text-muted-foreground'
          )}>
          {status}
        </span>
        <Button
          size='row'
          variant='outline'
          disabled={isPending}
          className={ROW_BUTTON}
          onClick={() => {
            change('reopen', 'Could Not Reopen')
          }}>
          <Undo2Icon className='size-3.5' />
          Reopen
        </Button>
        <DeleteButton row={{ id: report.id, kind: 'report' }} />
      </div>
    )
  }
  return (
    <div className='ml-auto flex shrink-0 items-center gap-2'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size='row'
            variant='outline'
            disabled={isPending}
            className={ROW_BUTTON}>
            <BanIcon className='size-3.5' />
            Drop
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-44'>
          {MANUAL_DROP_REASONS.map((reason) => (
            <DropdownMenuItem
              key={reason}
              onSelect={() => {
                change({ drop: reason }, 'Could Not Drop')
              }}>
              {DROP_REASONS[reason]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size='row'
        variant='outline'
        disabled={isPending}
        className={ROW_BUTTON}
        onClick={() => {
          change('resolve', 'Could Not Resolve')
        }}>
        <CheckIcon className='size-3.5' />
        Resolve
      </Button>
    </div>
  )
}

// fixed: the live version a fix by hand made after the fixer handed it over (admin-console.ts › fixedVersion)
const ReportItem = ({
  report,
  fixed,
}: {
  report: AdminReport
  fixed: number | undefined
}) => {
  const { data: songInfo } = useGetSongInfoBySongId(report.videoId)
  const state = reportState(report)
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
      <p
        className={cn(
          'text-pretty whitespace-pre-wrap',
          state === 'open' || state === 'review'
            ? 'text-foreground'
            : 'text-muted-foreground'
        )}>
        {report.message}
      </p>
      {state === 'review' &&
        (fixed === undefined ? (
          <p className='text-xs text-pretty text-muted-foreground'>
            Reviewed by Fixer · <When value={report.reviewAt ?? null} />
            {(report.reviewNote ?? '') !== '' && ` · ${report.reviewNote}`}
          </p>
        ) : (
          <p className='text-xs text-pretty text-muted-foreground'>
            <span className='text-success'>Fixed in v{fixed}</span> · Closes at
            the next fixer run
          </p>
        ))}
      {/* The closing note runs long (a fix's lines and seconds), so it gets its own line, never a truncated tail */}
      {(state === 'resolved' || state === 'dropped') &&
        (report.resolution ?? '') !== '' && (
          <p className='text-xs text-pretty text-muted-foreground'>
            Note · {report.resolution}
          </p>
        )}
      {/* Who, from what and when wraps whole rather than giving way to the actions; they drop under it when it's long */}
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5'>
        <p className='min-w-0 text-xs text-pretty text-muted-foreground'>
          {[by, clientLabel(report.client)].filter(Boolean).join(' · ')} ·{' '}
          <When value={report.createdAt} />
        </p>
        <ReportAction report={report} />
      </div>
    </li>
  )
}

// One state of a list at a time (Reports), each with its count: segmented buttons in a radio group
const StatePicker = <T extends string>({
  label,
  options,
  count,
  value,
  onChange,
}: {
  label: string
  options: readonly { id: T; name: string }[]
  count: (id: T) => number
  value: T
  onChange: (id: T) => void
}) => (
  <div
    ref={wheelSideways}
    role='radiogroup'
    aria-label={label}
    className='no-scrollbar inline-flex max-w-full gap-1 self-start overflow-x-auto rounded-lg bg-secondary p-1'>
    {options.map((option) => (
      <button
        key={option.id}
        type='button'
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- segmented buttons in an ARIA radio group, like the lyrics style scope
        role='radio'
        aria-checked={value === option.id}
        onClick={() => {
          onChange(option.id)
        }}
        className={cn(
          'h-7 shrink-0 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors touch:h-9 touch:px-4',
          value === option.id
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}>
        {option.name}
        <span className='ml-2 text-muted-foreground tabular-nums'>
          {count(option.id)}
        </span>
      </button>
    ))}
  </div>
)

// Fixed: in Needs Review, but a fix by hand is live, so the fixer resolves it at its next run
type ReportTab = ReportState | 'fixed'

const REPORT_TABS: {
  id: ReportTab
  name: string
  empty: string
  closed: boolean
}[] = [
  { closed: false, empty: 'No open reports', id: 'open', name: 'Open' },
  {
    closed: false,
    empty: 'Nothing waiting',
    id: 'review',
    name: 'Needs Review',
  },
  { closed: false, empty: 'Nothing waiting', id: 'fixed', name: 'Fixed' },
  {
    closed: true,
    empty: 'No resolved reports',
    id: 'resolved',
    name: 'Resolved',
  },
  { closed: true, empty: 'No dropped reports', id: 'dropped', name: 'Dropped' },
]

// Clear All on the Dropped tab: every dropped report, past those loaded too, with one Undo for all of them
const ClearDropped = () => {
  const { isPending, mutateAsync } = useClearDropped()
  const deleteWithUndo = useDeleteWithUndo()
  return (
    <Button
      variant='quiet'
      size='text'
      disabled={isPending}
      onClick={() => {
        void deleteWithUndo('Dropped Reports Deleted', 'report', async () => {
          const ids = await mutateAsync()
          return ids
        })
      }}>
      Clear All
    </Button>
  )
}

const REPORTS_LIMIT_MAX = 2000

// What listeners reported, newest first: the song, where in it, and what was wrong. One state at a time, open
// first; Needs Review holds what the backend's fixer couldn't fix, with when and its note, and Fixed those of them
// fixed by hand since; dropped ones (by an admin, the fixer's junk filter, or after 3 days open) show why. The
// counts are the Worker's, of every report, unless a search narrows them to the loaded ones. Resolved and Dropped
// show the newest 20, then 20 more a press, loading more from the Worker past the first 200
const ReportsList = ({ query }: { query: string }) => {
  const [limit, setLimit] = useState(REPORTS_LIMIT)
  const { data, error } = useAdminReports(limit)
  const [tab, setTab] = useState<ReportTab>('open')
  const [visible, setVisible] = useState(PAGE)
  const fixed = useFixedVersions(data?.reports ?? [])
  const searching = query.trim() !== ''
  const titles = useSongTitles(searching)
  if (error !== null) {
    return <LoadError error={error} />
  }
  if (data === undefined) {
    return <Skeleton className='h-40 w-full' />
  }
  const { reports, counts } = data
  if (reports.length === 0) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        No reports yet
      </p>
    )
  }
  const tabOf = (report: AdminReport): ReportTab => {
    const state = reportState(report)
    return state === 'review' && fixed.has(report.id) ? 'fixed' : state
  }
  const found = reports.filter((report) =>
    matchesQuery(query, [
      titles.get(report.videoId),
      report.videoId,
      report.message,
      report.name,
      report.email,
    ])
  )
  const inTab = (id: ReportTab) =>
    found.filter((report) => tabOf(report) === id)
  const count = (id: ReportTab) => {
    if (searching || counts === undefined) {
      return inTab(id).length
    }
    if (id === 'fixed') {
      return fixed.size
    }
    return id === 'review' ? counts.review - fixed.size : counts[id]
  }
  const option = REPORT_TABS.find(({ id }) => id === tab)
  const closed = option?.closed === true
  const all = inTab(tab)
  const shown = closed ? all.slice(0, visible) : all
  // Past the loaded rows, the Worker has more: a search covers only what is loaded
  const more =
    shown.length < all.length ||
    (closed &&
      !searching &&
      count(tab) > all.length &&
      limit < REPORTS_LIMIT_MAX)
  let list: ReactNode = (
    <ul className='text-sm'>
      {shown.map((report) => (
        <ReportItem
          key={report.id}
          report={report}
          fixed={fixed.get(report.id)}
        />
      ))}
    </ul>
  )
  if (shown.length === 0) {
    list = searching ? (
      <NoMatches />
    ) : (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        {option?.empty}
      </p>
    )
  }
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <StatePicker
          label='Report State'
          options={REPORT_TABS}
          count={count}
          value={tab}
          onChange={(next) => {
            setTab(next)
            setVisible(PAGE)
          }}
        />
        {tab === 'dropped' && !searching && count('dropped') > 0 && (
          <ClearDropped />
        )}
      </div>
      {list}
      {more && (
        <ShowMore
          onClick={() => {
            setVisible(visible + PAGE)
            if (visible + PAGE > all.length && !searching) {
              setLimit(Math.min(limit + REPORTS_LIMIT, REPORTS_LIMIT_MAX))
            }
          }}
        />
      )}
    </div>
  )
}

const FLAG_LABELS: Record<SignalFlag, string> = {
  automated: 'Automated',
  new_at_limit: 'New at Limit',
  refused: 'Hit a Limit',
  shared_network: 'Shared Network',
}

const songsLink = (email: string) =>
  `?tab=songs&user=${encodeURIComponent(email)}`

// Leads, not verdicts: a family shares a network and a fan can hit the limit on day one. Block from Accounts
const SignalsPanel = () => {
  const { data, error } = useAdminSignals()
  if (error !== null) {
    return error.message.includes('404') ? (
      <p className='text-sm text-error'>Needs the Worker update</p>
    ) : (
      <LoadError error={error} />
    )
  }
  if (data === undefined) {
    return <Skeleton className='h-40 w-full' />
  }
  if (data.accounts.length === 0 && data.networks.length === 0) {
    return (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        Nothing in the last 7 days
      </p>
    )
  }
  return (
    <div className='flex flex-col gap-8 text-sm'>
      {data.accounts.length > 0 && (
        <section className='flex flex-col gap-2'>
          <h2 className='text-base font-semibold text-foreground'>Accounts</h2>
          <ul>
            {data.accounts.map((account) => (
              <li
                key={account.id}
                className='flex flex-col gap-1.5 border-t border-border py-3'>
                <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                  <Link
                    to={songsLink(account.email)}
                    className='font-medium text-foreground hover:underline'>
                    {account.name}
                  </Link>
                  <span className='min-w-0 truncate text-muted-foreground'>
                    {account.email}
                  </span>
                  {account.flags.map((flag) => (
                    <Badge
                      key={flag}
                      tone={flag === 'automated' ? 'error' : 'neutral'}>
                      {FLAG_LABELS[flag]}
                    </Badge>
                  ))}
                </div>
                <p className='truncate text-xs text-muted-foreground'>
                  {account.songs} songs · {account.refusals} refused · joined{' '}
                  <When value={account.createdAt} />
                  {account.client !== null &&
                    ` · ${account.client === '' ? 'No browser name' : account.client}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.networks.length > 0 && (
        <section className='flex flex-col gap-2'>
          <h2 className='text-base font-semibold text-foreground'>Networks</h2>
          <ul>
            {data.networks.map((network) => (
              <li
                key={network.key}
                className='flex flex-col gap-1.5 border-t border-border py-3'>
                <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                  <span className='font-medium text-foreground tabular-nums'>
                    Network {network.key}
                  </span>
                  {network.automated && <Badge tone='error'>Automated</Badge>}
                </div>
                <p className='text-muted-foreground'>
                  {network.accounts.length === 0
                    ? 'Guests only'
                    : network.accounts.map((account, index) => (
                        <span key={account.id}>
                          {index > 0 && ', '}
                          <Link
                            to={songsLink(account.email)}
                            className='text-foreground hover:underline'>
                            {account.name}
                          </Link>
                        </span>
                      ))}
                </p>
                <p className='text-xs text-muted-foreground'>
                  {network.songs} songs · {network.guestSongs} as guests ·{' '}
                  {network.refusals} refused
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// Each usage event's name, as a column reads (worker/src/events.ts)
const EVENT_LABELS: Record<string, string> = {
  app_open: 'App Opens',
  install_prompt: 'Install App Pressed',
  installed: 'Installs',
  lyrics_feature: 'Lyrics Toggles',
  share: 'Shares',
  song_open: 'Song Opens',
}

const UsageCell = ({ children }: { children: number | string }) => (
  <td className='px-3 py-2 text-right whitespace-nowrap tabular-nums'>
    {children}
  </td>
)

// How the app is used: people active, what they open and press, and what the server records anyway
// (worker/src/events.ts › readUsage). Counting began with the usage events, so earlier days read 0 people
// A song by its title (its id until the title loads, or for a song not in the library), linking to its page
const SongName = ({ videoId }: { videoId: string }) => {
  const { data: songInfo } = useGetSongInfoBySongId(videoId)
  return (
    <Link
      to={`/v/${videoId}`}
      title={videoId}
      className='min-w-0 truncate text-foreground hover:underline'>
      {songInfo?.title ?? videoId}
    </Link>
  )
}

const UsagePanel = () => {
  const { data, error } = useAdminUsage()
  if (error !== null) {
    return error.message.includes('404') ? (
      <p className='text-sm text-error'>Needs the Worker update</p>
    ) : (
      <LoadError error={error} />
    )
  }
  if (data === undefined) {
    return <Skeleton className='h-40 w-full' />
  }
  return (
    <div className='flex flex-col gap-8 text-sm'>
      <p className='text-base text-foreground'>
        <span className='font-semibold tabular-nums'>{data.week.active}</span>{' '}
        people in the last 7 days ·{' '}
        <span className='tabular-nums'>{data.week.signedIn}</span> signed in
      </p>
      <section className='flex flex-col gap-2'>
        <h2 className='text-base font-semibold text-foreground'>
          By Day (UTC)
        </h2>
        {/* Wheel stays native: a table reads down the page, so the wheel over it scrolls the page */}
        <div className='overflow-x-auto'>
          <table className='w-full min-w-xl border-collapse'>
            <thead className='text-xs text-muted-foreground'>
              <tr>
                <th className='px-3 py-2 text-left font-medium whitespace-nowrap'>
                  Day
                </th>
                <th className='px-3 py-2 text-right font-medium whitespace-nowrap'>
                  People
                </th>
                <th className='px-3 py-2 text-right font-medium whitespace-nowrap'>
                  Signed In
                </th>
                <th className='px-3 py-2 text-right font-medium whitespace-nowrap'>
                  Song Opens
                </th>
                <th className='px-3 py-2 text-right font-medium whitespace-nowrap'>
                  New Accounts
                </th>
                <th className='px-3 py-2 text-right font-medium whitespace-nowrap'>
                  Generations
                </th>
                <th className='px-3 py-2 text-right font-medium whitespace-nowrap'>
                  Failed
                </th>
                <th className='px-3 py-2 text-right font-medium whitespace-nowrap'>
                  Reports
                </th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((day) => (
                <tr key={day.day} className='border-t border-border'>
                  <td className='px-3 py-2 text-left whitespace-nowrap tabular-nums'>
                    {day.day}
                  </td>
                  <UsageCell>{day.active}</UsageCell>
                  <UsageCell>{day.signedIn}</UsageCell>
                  <UsageCell>{day.songOpens}</UsageCell>
                  <UsageCell>{day.newAccounts}</UsageCell>
                  <UsageCell>{day.generations}</UsageCell>
                  <UsageCell>{day.generationsFailed}</UsageCell>
                  <UsageCell>{day.reports}</UsageCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className='flex flex-col gap-2'>
        <h2 className='text-base font-semibold text-foreground'>Last 7 Days</h2>
        {data.events.length === 0 ? (
          <p className='text-muted-foreground'>No events yet</p>
        ) : (
          <table className='w-full border-collapse'>
            <thead className='text-xs text-muted-foreground'>
              <tr>
                <th className='px-3 py-2 text-left font-medium whitespace-nowrap'>
                  Event
                </th>
                <th className='px-3 py-2 text-right font-medium whitespace-nowrap'>
                  Times
                </th>
                <th className='px-3 py-2 text-right font-medium whitespace-nowrap'>
                  People
                </th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr key={event.name} className='border-t border-border'>
                  <td className='px-3 py-2 text-left'>
                    {EVENT_LABELS[event.name] ?? event.name}
                  </td>
                  <UsageCell>{event.count}</UsageCell>
                  <UsageCell>{event.actors}</UsageCell>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className='flex flex-col gap-2'>
        <h2 className='text-base font-semibold text-foreground'>
          Recent Plays
        </h2>
        {data.plays.length === 0 ? (
          <p className='text-muted-foreground'>No plays yet</p>
        ) : (
          <ol data-bench='usage-plays'>
            {data.plays.map((play) => (
              <li
                key={`${play.at}-${play.by}-${play.videoId}`}
                className='flex items-center justify-between gap-3 border-t border-border px-3 py-2'>
                <SongName videoId={play.videoId} />
                <span className='shrink-0 text-muted-foreground'>
                  {play.by} · <When value={play.at} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className='flex flex-col gap-2'>
        <h2 className='text-base font-semibold text-foreground'>
          Most Listened
        </h2>
        <ol>
          {data.songs.map((song) => (
            <li
              key={song.videoId}
              className='flex items-center justify-between gap-3 border-t border-border px-3 py-2'>
              <SongName videoId={song.videoId} />
              <span className='shrink-0 text-muted-foreground tabular-nums'>
                {song.listens} listens
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

// Who wrote: their reply address, else their account, else a guest
const messageFrom = (message: AdminMessage) =>
  message.replyTo ??
  message.accountEmail ??
  (message.sender === null || message.sender.startsWith('d:')
    ? 'Guest'
    : message.sender)

// What an Inbox row is, above its title: the three kinds share one list
const KindLabel = ({ kind }: { kind: 'Feedback' | 'Message' | 'Request' }) => (
  <div className='flex'>
    <Badge tone='neutral'>{kind}</Badge>
  </div>
)

// A Contact Me message (worker/src/contact.ts): it was also emailed, unless it says why not
const MessageItem = ({ message }: { message: AdminMessage }) => (
  <li className='flex flex-col gap-1.5 border-t border-border py-3 text-sm'>
    <KindLabel kind='Message' />
    <div className='flex flex-wrap items-baseline justify-between gap-x-3'>
      <p className='font-semibold text-foreground'>{message.subject}</p>
      <p className='text-xs text-muted-foreground'>
        <When value={message.createdAt} />
      </p>
    </div>
    <p className='wrap-break-word whitespace-pre-wrap text-foreground'>
      {message.message}
    </p>
    {/* As a feedback's: who wraps whole, and Delete drops under it when it's long */}
    <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5'>
      <p className='min-w-0 text-xs wrap-break-word text-muted-foreground'>
        {message.replyTo === null ? (
          messageFrom(message)
        ) : (
          <a
            href={`mailto:${message.replyTo}`}
            className='underline underline-offset-2 hover:text-foreground'>
            {message.replyTo}
          </a>
        )}
        {message.emailError !== null && (
          <span className='text-error'>
            {' '}
            · Not Emailed: {message.emailError}
          </span>
        )}
      </p>
      <div className='ml-auto flex shrink-0 items-center gap-2'>
        <DeleteButton row={{ id: message.id, kind: 'message' }} />
      </div>
    </div>
  </li>
)

// Resolve tells a signed sender in the app; Drop tells nobody; Reopen undoes either, so none asks first
const FeedbackAction = ({ feedback }: { feedback: AdminFeedback }) => {
  const { toast } = useToast()
  const { isPending, mutate } = useChangeFeedback()
  const state = feedbackState(feedback)
  const change = (next: FeedbackChange, failure: string) => {
    mutate(
      { change: next, id: feedback.id },
      {
        onError: (error) => {
          toast({
            description: error.message,
            title: failure,
            variant: 'destructive',
          })
        },
      }
    )
  }
  if (state !== 'open') {
    return (
      <div className='ml-auto flex shrink-0 items-center gap-2'>
        <span
          className={cn(
            'text-xs whitespace-nowrap',
            state === 'resolved' ? 'text-success' : 'text-muted-foreground'
          )}>
          {state === 'resolved' ? 'Resolved' : 'Dropped'}
        </span>
        <Button
          size='row'
          variant='outline'
          disabled={isPending}
          className={ROW_BUTTON}
          onClick={() => {
            change('reopen', 'Could Not Reopen')
          }}>
          <Undo2Icon className='size-3.5' />
          Reopen
        </Button>
        <DeleteButton row={{ id: feedback.id, kind: 'feedback' }} />
      </div>
    )
  }
  return (
    <div className='ml-auto flex shrink-0 items-center gap-2'>
      <Button
        size='row'
        variant='outline'
        disabled={isPending}
        className={ROW_BUTTON}
        onClick={() => {
          change('drop', 'Could Not Drop')
        }}>
        <BanIcon className='size-3.5' />
        Drop
      </Button>
      <Button
        size='row'
        variant='outline'
        disabled={isPending}
        className={ROW_BUTTON}
        onClick={() => {
          change('resolve', 'Could Not Resolve')
        }}>
        <CheckIcon className='size-3.5' />
        Resolve
      </Button>
    </div>
  )
}

const isAnonymous = (feedback: AdminFeedback) =>
  feedback.anonymous === 1 || feedback.anonymous === true

const FeedbackItem = ({ feedback }: { feedback: AdminFeedback }) => {
  const open = feedbackState(feedback) === 'open'
  let from = feedback.name ?? 'Deleted Account'
  if (isAnonymous(feedback)) {
    from = 'Anonymous'
  } else if (feedback.email !== null) {
    from = `${from} · ${feedback.email}`
  }
  return (
    <li className='flex flex-col gap-1.5 border-t border-border py-3 text-sm'>
      <KindLabel kind='Feedback' />
      <p className='font-semibold text-pretty text-foreground'>
        {feedback.subject}
      </p>
      <p
        className={cn(
          'wrap-break-word whitespace-pre-wrap',
          open ? 'text-foreground' : 'text-muted-foreground'
        )}>
        {feedback.message}
      </p>
      {/* Who and when wraps whole rather than giving way to the actions; they drop under it when it's long */}
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5'>
        <p className='min-w-0 text-xs text-pretty wrap-break-word text-muted-foreground'>
          {from} · <When value={feedback.createdAt} />
        </p>
        <FeedbackAction feedback={feedback} />
      </div>
    </li>
  )
}

const REQUEST_STATUS = {
  approved: 'Approved',
  declined: 'Declined',
  open: 'Waiting',
} as const

// One request: who asked, their note, what they have now. Approve asks for the songs a day first (10 to start,
// editable later on Accounts); Decline is one press
const RequestRow = ({ request }: { request: AdminRequest }) => {
  const [approving, setApproving] = useState(false)
  const [songs, setSongs] = useState('10')
  const { isPending, mutate: decide } = useDecideRequest()
  const { toast } = useToast()
  const count = Number(songs)
  const valid = Number.isInteger(count) && count >= 1 && count <= 1000
  const failed = (title: string) => ({
    onError: (error: Error) => {
      toast({ description: error.message, title, variant: 'destructive' })
    },
  })
  let now = 'Default'
  if (request.dailyLimit === 'unlimited') {
    now = 'Unlimited'
  } else if (typeof request.dailyLimit === 'number') {
    now = `${request.dailyLimit} a day`
  }
  return (
    <li className='flex flex-col gap-1.5 border-t border-border py-3 text-sm'>
      <KindLabel kind='Request' />
      <div className='flex flex-wrap items-baseline justify-between gap-x-3'>
        <p className='font-semibold text-foreground'>{request.name}</p>
        <p className='text-xs text-muted-foreground'>
          {REQUEST_STATUS[request.status]}
          {request.status === 'approved' &&
            request.granted !== null &&
            ` · ${request.granted} a day`}
          {' · '}
          <When value={request.createdAt} />
        </p>
      </div>
      <p className='wrap-break-word whitespace-pre-wrap text-foreground'>
        {request.note}
      </p>
      <p className='truncate text-xs text-muted-foreground'>
        {request.email} · Now: {now}
      </p>
      {request.status === 'open' &&
        (approving ? (
          <form
            className='flex flex-wrap items-center gap-2'
            onSubmit={(event) => {
              event.preventDefault()
              if (valid) {
                decide(
                  { dailyLimit: count, id: request.id },
                  failed('Could Not Approve')
                )
              }
            }}>
            <label
              htmlFor={`songs-${request.id}`}
              className='text-muted-foreground'>
              Songs a Day
            </label>
            <Input
              id={`songs-${request.id}`}
              type='number'
              inputMode='numeric'
              min={1}
              max={1000}
              value={songs}
              className='w-24'
              onChange={(event) => {
                setSongs(event.target.value)
              }}
            />
            <Button type='submit' size='row' disabled={!valid || isPending}>
              Approve
            </Button>
            <Button
              type='button'
              size='row'
              variant='ghost'
              onClick={() => {
                setApproving(false)
              }}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className='flex gap-2'>
            <Button
              size='row'
              disabled={isPending}
              onClick={() => {
                setApproving(true)
              }}>
              Approve
            </Button>
            <Button
              size='row'
              variant='outline'
              disabled={isPending}
              onClick={() => {
                decide(
                  { dailyLimit: null, id: request.id },
                  failed('Could Not Decline')
                )
              }}>
              Decline
            </Button>
          </div>
        ))}
    </li>
  )
}

// open: waiting on the admin (feedback not resolved or dropped, a request not decided). A message has nothing to
// decide, so it is settled from the start
type InboxItem = { at: number; open: boolean; text: (string | null)[] } & (
  | { kind: 'feedback'; item: AdminFeedback }
  | { kind: 'message'; item: AdminMessage }
  | { kind: 'request'; item: AdminRequest }
)

// Everything people sent: Send Feedback (worker/src/feedback.ts), Contact Me messages and requests for more songs
// a day, each labelled with its kind: what waits on the admin first, then the rest, newest first, 20 at a time.
// A source that fails says so above the rest
const InboxPanel = ({ query }: { query: string }) => {
  const feedback = useAdminFeedback()
  const messages = useAdminMessages()
  const requests = useAdminRequests()
  const [visible, setVisible] = useState(PAGE)
  const sources = [feedback, messages, requests]
  if (
    sources.some((source) => source.data === undefined && source.error === null)
  ) {
    return <Skeleton className='h-40 w-full' />
  }
  const loaded: InboxItem[] = [
    ...(feedback.data?.feedback ?? []).map((item) => ({
      at: item.createdAt,
      item,
      kind: 'feedback' as const,
      open: feedbackState(item) === 'open',
      text: [item.subject, item.message, item.name, item.email],
    })),
    ...(messages.data?.messages ?? []).map((item) => ({
      at: item.createdAt,
      item,
      kind: 'message' as const,
      open: false,
      text: [
        item.subject,
        item.message,
        item.replyTo,
        item.accountName,
        item.accountEmail,
      ],
    })),
    ...(requests.data?.requests ?? []).map((item) => ({
      at: item.createdAt,
      item,
      kind: 'request' as const,
      open: item.status === 'open',
      text: [item.note, item.name, item.email],
    })),
  ]
  const found = loaded
    .filter((entry) => matchesQuery(query, entry.text))
    .toSorted((a, b) => Number(b.open) - Number(a.open) || b.at - a.at)
  const open = found.filter((entry) => entry.open).length
  const items = found.slice(0, open + visible)
  const errors = sources.flatMap((source) =>
    source.error === null ? [] : [source.error]
  )
  let empty: ReactNode = null
  if (items.length === 0 && errors.length === 0) {
    empty =
      loaded.length === 0 ? (
        <p className='text-sm text-muted-foreground'>Nothing yet</p>
      ) : (
        <NoMatches />
      )
  }
  return (
    <div className='flex flex-col gap-3'>
      {errors.map((error) =>
        error.message.includes('404') ? (
          <p key={error.message} className='text-sm text-error'>
            Needs the Worker update
          </p>
        ) : (
          <LoadError key={error.message} error={error} />
        )
      )}
      {empty ?? (
        <ol className='flex flex-col'>
          {items.map((entry) => {
            if (entry.kind === 'feedback') {
              return (
                <FeedbackItem key={`f${entry.item.id}`} feedback={entry.item} />
              )
            }
            if (entry.kind === 'message') {
              return (
                <MessageItem key={`m${entry.item.id}`} message={entry.item} />
              )
            }
            return <RequestRow key={`r${entry.item.id}`} request={entry.item} />
          })}
        </ol>
      )}
      {items.length < found.length && (
        <ShowMore
          onClick={() => {
            setVisible(visible + PAGE)
          }}
        />
      )}
    </div>
  )
}

const TABS = [
  'songs',
  'reports',
  'recommendations',
  'accounts',
  'signals',
  'usage',
  'inbox',
] as const
type Tab = (typeof TABS)[number]
const isTab = (value: string | null): value is Tab =>
  TABS.some((tab) => tab === value)
// The tabs Inbox replaced, so an older link still lands on what it pointed at
const INBOX_ALIASES = new Set(['feedback', 'messages', 'requests'])
const tabOf = (value: string | null): Tab => {
  if (isTab(value)) {
    return value
  }
  return value !== null && INBOX_ALIASES.has(value) ? 'inbox' : 'songs'
}

// One list at a time, each of which can run long. The tab and the Songs filter live in the address, so a
// reload, a shared link or a requester's name (ByLink) lands on the same view
const AdminTabs = () => {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab = tabOf(tabParam)
  const by = params.get('user')
  const { query, setQuery } = useListQuery()
  const search = (label: string, placeholder: string) => (
    <SearchField
      label={label}
      placeholder={placeholder}
      value={query}
      onChange={setQuery}
      className='w-full sm:max-w-sm'
    />
  )
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
      {/* Scrolls sideways on a phone too narrow for every tab */}
      <div
        ref={wheelSideways}
        className='-mx-1 no-scrollbar overflow-x-auto px-1'>
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
          <TabsTrigger value='signals' className='h-full'>
            Signals
          </TabsTrigger>
          <TabsTrigger value='usage' className='h-full'>
            Usage
          </TabsTrigger>
          <TabsTrigger value='inbox' className='h-full'>
            Inbox
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value='songs' className='mt-4'>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-x-4 gap-y-3'>
            {search('Search Songs', 'Song, Video ID or Account')}
            <SongsFilter
              by={by}
              onChange={(user) => {
                show('songs', user)
              }}
            />
          </div>
          {/* Keyed by the filter and the search, so either starts on the first page */}
          <SongsTable key={`${by ?? ''}\n${query}`} by={by} query={query} />
        </div>
      </TabsContent>
      <TabsContent value='reports' className='mt-4'>
        <div className='flex flex-col gap-3'>
          {search('Search Reports', 'Song, Message or Reporter')}
          <ReportsList query={query} />
        </div>
      </TabsContent>
      <TabsContent value='recommendations' className='mt-4'>
        <div className='flex flex-col gap-3'>
          <p className='text-sm text-muted-foreground'>
            The landing page&apos;s carousel, shuffled for each visitor. The mic
            marks songs that have karaoke lyrics
          </p>
          <RecommendationsEditor />
        </div>
      </TabsContent>
      <TabsContent value='accounts' className='mt-4'>
        <div className='flex flex-col gap-3'>
          <p className='text-sm text-muted-foreground'>
            Everyone who has signed in, most recently seen first
          </p>
          {search('Search Accounts', 'Name, Email or ID')}
          <UsersTable query={query} />
        </div>
      </TabsContent>
      <TabsContent value='signals' className='mt-4'>
        <SignalsPanel />
      </TabsContent>
      <TabsContent value='usage' className='mt-4'>
        <UsagePanel />
      </TabsContent>
      <TabsContent value='inbox' className='mt-4'>
        <div className='flex flex-col gap-3'>
          {search('Search Inbox', 'Text, Name or Email')}
          <InboxPanel query={query} />
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
