import { useState } from 'react'
import { Navigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useAdminSettings,
  useAdminUsers,
  useSetBlocked,
  useSetGenerationEnabled,
  useSetHourlyLimit,
} from '@/lib/admin'
import type { AdminUser } from '@/lib/admin'
import { useAccess, useMe } from '@/lib/auth'
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

// Empty means the default limit; saved on Enter or when the field loses focus
const LimitField = ({
  user,
  defaultLimit,
}: {
  user: AdminUser
  defaultLimit: number
}) => {
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
      placeholder={String(defaultLimit)}
      value={value}
      disabled={isPending}
      className='h-8 w-20'
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

const UserRow = ({
  user,
  defaultLimit,
  isSelf,
}: {
  user: AdminUser
  defaultLimit: number
  isSelf: boolean
}) => {
  const blocked = user.banned === 1 || user.banned === true
  const admin = user.role === 'admin'
  const { isPending, mutate: setBlocked } = useSetBlocked()
  return (
    <tr
      className={cn(
        'border-t border-white/10 align-middle',
        blocked && 'text-muted-foreground'
      )}>
      <th scope='row' className='py-2 pr-4 text-left font-normal'>
        <span className='block truncate font-medium text-foreground'>
          {user.email}
        </span>
        <span className='block truncate text-xs text-muted-foreground'>
          {user.name}
        </span>
      </th>
      <td className='py-2 pr-4'>{admin ? 'Admin' : 'User'}</td>
      <td className='py-2 pr-4 whitespace-nowrap'>
        {formatWhen(user.lastSeenAt)}
      </td>
      <td className='py-2 pr-4 text-right tabular-nums'>
        {user.songsLastHour}
      </td>
      <td className='py-2 pr-4 text-right tabular-nums'>{user.songsTotal}</td>
      <td className='py-2 pr-4'>
        {admin ? (
          <span className='text-xs text-muted-foreground'>None</span>
        ) : (
          <LimitField user={user} defaultLimit={defaultLimit} />
        )}
      </td>
      <td className='py-2 text-right'>
        {isSelf || admin ? null : (
          <Button
            size='sm'
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
      <table className='w-full text-left text-sm'>
        <thead className='text-xs text-muted-foreground'>
          <tr>
            <th className='pr-4 pb-2 font-medium'>Account</th>
            <th className='pr-4 pb-2 font-medium'>Role</th>
            <th className='pr-4 pb-2 font-medium'>Last Seen</th>
            <th className='pr-4 pb-2 text-right font-medium'>Last Hour</th>
            <th className='pr-4 pb-2 text-right font-medium'>Total Songs</th>
            <th className='pr-4 pb-2 font-medium'>Hourly Limit</th>
            <th className='pb-2 font-medium'>
              <span className='sr-only'>Block</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              defaultLimit={settings.limits.user}
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

// Admins only: anyone else goes home, once the sign-in check has answered
const AdminPage = () => {
  const { admin, ready } = useAccess()
  if (!ready) {
    return null
  }
  if (!admin) {
    return <Navigate to='/' replace />
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
    </div>
  )
}

export default AdminPage
