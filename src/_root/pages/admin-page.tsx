import { useState } from 'react'
import { Link } from 'react-router'

import Forbidden from '@/components/shared/forbidden'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useAdminGenerations,
  useAdminSettings,
  useAdminUsers,
  useSetBlocked,
  useSetGenerationEnabled,
  useSetHourlyLimit,
} from '@/lib/admin'
import type { AdminGeneration, AdminUser } from '@/lib/admin'
import { useAccess, useMe } from '@/lib/auth'
import { useGetSongInfoBySongId } from '@/lib/react-query/queries-and-mutations'
import { cn } from '@/utils/cn'

const formatWhen = (value: string | number | null) => {
  if (value === null) {
    return 'Never'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className='flex flex-col gap-0.5'>
    <span className='text-xs text-muted-foreground'>{label}</span>
    <span className='text-sm font-medium text-foreground tabular-nums'>
      {value}
    </span>
  </div>
)

const GenerationPanel = () => {
  const { data } = useAdminSettings()
  const { isPending, mutate: setEnabled } = useSetGenerationEnabled()
  if (data === undefined) {
    return <Skeleton className='h-20 w-full' />
  }
  const { generationEnabled, guestSongsToday, limits } = data
  return (
    <section className='flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-white/10 bg-card/60 p-4'>
      <Stat
        label='Generation'
        value={generationEnabled ? 'On' : 'Paused for Everyone'}
      />
      <Stat label='Signed-In Limit' value={`${limits.user} an hour`} />
      <Stat label='Guest Limit' value={`${limits.guest} a day per network`} />
      <Stat
        label='Guest Songs Today'
        value={`${guestSongsToday} of ${limits.guestTotal}`}
      />
      <Button
        className='ml-auto'
        variant={generationEnabled ? 'destructive' : 'default'}
        disabled={isPending}
        onClick={() => {
          setEnabled(!generationEnabled)
        }}>
        {generationEnabled ? 'Pause Generation' : 'Resume Generation'}
      </Button>
    </section>
  )
}

// Empty means the default limit (shown in the panel above); saved on Enter or when the field loses focus
const LimitField = ({ user }: { user: AdminUser }) => {
  const saved = user.hourlyLimit === null ? '' : String(user.hourlyLimit)
  const [value, setValue] = useState(saved)
  const { isPending, mutate: setLimit } = useSetHourlyLimit()
  const save = () => {
    const trimmed = value.trim()
    if (trimmed === saved) {
      return
    }
    const limit = Number(trimmed)
    if (trimmed !== '' && (!Number.isInteger(limit) || limit < 0)) {
      setValue(saved)
      return
    }
    setLimit({ hourlyLimit: trimmed === '' ? null : limit, userId: user.id })
  }
  return (
    <Input
      aria-label={`Hourly Limit for ${user.email}`}
      inputMode='numeric'
      placeholder='Default'
      value={value}
      disabled={isPending}
      className='h-8 w-full'
      onChange={(event) => {
        setValue(event.target.value)
      }}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
    />
  )
}

const UserRow = ({ user, isSelf }: { user: AdminUser; isSelf: boolean }) => {
  const blocked = user.banned === 1 || user.banned === true
  const admin = user.role === 'admin'
  const { isPending, mutate: setBlocked } = useSetBlocked()
  return (
    <tr
      className={cn(
        'h-14 border-t border-white/10 align-middle',
        blocked && 'text-muted-foreground'
      )}>
      <th scope='row' className='pr-3 text-left font-normal'>
        <span className='block truncate font-medium text-foreground'>
          {user.name}
        </span>
        <span className='block truncate text-xs text-muted-foreground'>
          {user.email}
        </span>
      </th>
      <td className='px-3'>{admin ? 'Admin' : 'User'}</td>
      <td className='truncate px-3'>{formatWhen(user.lastSeenAt)}</td>
      <td className='px-3 text-right tabular-nums'>{user.songsLastHour}</td>
      <td className='px-3 text-right tabular-nums'>{user.songsTotal}</td>
      <td className='px-3'>
        {admin ? (
          <span className='text-muted-foreground'>No Limit</span>
        ) : (
          <LimitField user={user} />
        )}
      </td>
      <td className='pl-3 text-right'>
        {isSelf || admin ? null : (
          <Button
            size='sm'
            className='w-full'
            variant={blocked ? 'outline' : 'destructive'}
            disabled={isPending}
            onClick={() => {
              setBlocked({ blocked: !blocked, userId: user.id })
            }}>
            {blocked ? 'Unblock' : 'Block'}
          </Button>
        )}
      </td>
    </tr>
  )
}

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
  return (
    <div className='overflow-x-auto'>
      {/* Fixed columns, so every row lines up whatever its content */}
      <table className='w-full min-w-3xl table-fixed text-left text-sm'>
        <colgroup>
          <col className='w-3/10' />
          <col className='w-1/12' />
          <col className='w-1/5' />
          <col className='w-1/12' />
          <col className='w-1/10' />
          <col className='w-1/8' />
          <col />
        </colgroup>
        <thead className='text-xs text-muted-foreground'>
          <tr>
            <th className='pr-3 pb-2 font-medium'>Account</th>
            <th className='px-3 pb-2 font-medium'>Role</th>
            <th className='px-3 pb-2 font-medium'>Last Seen</th>
            <th className='px-3 pb-2 text-right font-medium'>Last Hour</th>
            <th className='px-3 pb-2 text-right font-medium'>Total Songs</th>
            <th className='px-3 pb-2 font-medium'>Hourly Limit</th>
            <th className='pb-2 pl-3 font-medium'>
              <span className='sr-only'>Block</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === me?.user?.id}
            />
          ))}
        </tbody>
      </table>
      {users.length === 0 && (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          No one has signed in yet.
        </p>
      )}
    </div>
  )
}

const KIND_LABELS = {
  new: 'New',
  regenerate: 'Regenerate',
  retime: 'Retime',
} as const

const STATUS_LABELS = {
  failed: 'Failed',
  reserved: 'In Progress',
  running: 'In Progress',
  succeeded: 'Done',
} as const

const SongRow = ({ generation }: { generation: AdminGeneration }) => {
  const { data: songInfo } = useGetSongInfoBySongId(generation.videoId)
  const path = `/v/${generation.videoId}`
  const guest = generation.guest === 1 || generation.guest === true
  return (
    <tr className='h-14 border-t border-white/10 align-middle'>
      <th scope='row' className='pr-3 text-left font-normal'>
        <Link
          to={path}
          className='block truncate font-medium text-foreground hover:underline'>
          {songInfo?.title ?? generation.videoId}
        </Link>
        <span className='block truncate text-xs text-muted-foreground'>
          synbox.io{path}
        </span>
      </th>
      <td className='px-3'>
        <span className='block truncate'>
          {guest ? 'Guest' : (generation.name ?? 'Deleted Account')}
        </span>
        {!guest && generation.email !== null && (
          <span className='block truncate text-xs text-muted-foreground'>
            {generation.email}
          </span>
        )}
      </td>
      <td className='px-3'>{KIND_LABELS[generation.kind]}</td>
      <td
        className={cn(
          'px-3',
          generation.status === 'failed' && 'text-error',
          generation.status === 'succeeded' && 'text-foreground',
          (generation.status === 'reserved' ||
            generation.status === 'running') &&
            'text-muted-foreground'
        )}>
        {STATUS_LABELS[generation.status]}
      </td>
      <td className='truncate pl-3'>{formatWhen(generation.createdAt)}</td>
    </tr>
  )
}

// Every song generated since accounts arrived, newest first
const SongsTable = () => {
  const { data: generations, error } = useAdminGenerations()
  if (error !== null) {
    return <p className='text-sm text-error'>{error.message}</p>
  }
  if (generations === undefined) {
    return <Skeleton className='h-40 w-full' />
  }
  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-3xl table-fixed text-left text-sm'>
        <colgroup>
          <col className='w-1/3' />
          <col className='w-1/4' />
          <col className='w-1/10' />
          <col className='w-1/10' />
          <col />
        </colgroup>
        <thead className='text-xs text-muted-foreground'>
          <tr>
            <th className='pr-3 pb-2 font-medium'>Song</th>
            <th className='px-3 pb-2 font-medium'>By</th>
            <th className='px-3 pb-2 font-medium'>Kind</th>
            <th className='px-3 pb-2 font-medium'>Status</th>
            <th className='pb-2 pl-3 font-medium'>When</th>
          </tr>
        </thead>
        <tbody>
          {generations.map((generation) => (
            <SongRow key={generation.id} generation={generation} />
          ))}
        </tbody>
      </table>
      {generations.length === 0 && (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          No songs generated yet.
        </p>
      )}
    </div>
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
    <div className='mx-auto flex w-full max-w-5xl flex-col gap-6 overflow-y-auto px-4 pt-page-top pb-page-bottom-lg'>
      <title>Admin · Synbox</title>
      <h1 className='text-2xl font-bold text-foreground'>Admin</h1>
      <GenerationPanel />
      <section className='flex flex-col gap-3'>
        <h2 className='text-lg font-semibold text-foreground'>Accounts</h2>
        <p className='text-sm text-muted-foreground'>
          Blocking signs the person out everywhere and stops their songs. An
          empty limit uses the default.
        </p>
        <UsersTable />
      </section>
      <section className='flex flex-col gap-3'>
        <h2 className='text-lg font-semibold text-foreground'>Songs</h2>
        <SongsTable />
      </section>
    </div>
  )
}

export default AdminPage
