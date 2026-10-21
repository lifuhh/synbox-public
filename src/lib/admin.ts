import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { authClient } from '@/lib/auth'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

// The auth Worker's /api/admin routes (worker/src/index.ts); each checks the admin role on the server

// D1 hands back Better Auth's dates as text or epoch milliseconds
const when = z.union([z.string(), z.number()])

const adminUserSchema = z.object({
  banned: z.union([z.number(), z.boolean()]).nullable(),
  createdAt: when,
  email: z.string(),
  hourlyLimit: z.number().nullable(),
  id: z.string(),
  image: z.string().nullable(),
  lastSeenAt: when.nullable(),
  name: z.string(),
  role: z.string().nullable(),
  songsLastHour: z.number(),
  songsTotal: z.number(),
})

const settingsSchema = z.object({
  generationEnabled: z.boolean(),
  guestSongsToday: z.number(),
  limits: z.object({
    guest: z.number(),
    guestTotal: z.number(),
    user: z.number(),
  }),
})

export type AdminUser = z.infer<typeof adminUserSchema>

const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`The admin API answered ${response.status}`)
  }
  return response.status === 204 ? null : await response.json()
}

export const useAdminUsers = () =>
  useQuery({
    queryFn: async () =>
      z.object({ users: z.array(adminUserSchema) }).parse(await call('/users'))
        .users,
    queryKey: [QUERY_KEYS.GET_ADMIN_USERS],
  })

export const useAdminSettings = () =>
  useQuery({
    queryFn: async () => settingsSchema.parse(await call('/settings')),
    queryKey: [QUERY_KEYS.GET_ADMIN_SETTINGS],
  })

const useRefreshing = <T>(run: (input: T) => Promise<unknown>) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_ADMIN_USERS],
      })
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_ADMIN_SETTINGS],
      })
    },
  })
}

// null puts the user back on the default limit
export const useSetHourlyLimit = () =>
  useRefreshing(
    async ({
      hourlyLimit,
      userId,
    }: {
      userId: string
      hourlyLimit: number | null
    }) =>
      await call(`/users/${encodeURIComponent(userId)}/limit`, {
        body: JSON.stringify({ hourlyLimit }),
        method: 'PUT',
      })
  )

// Better Auth's admin plugin: a block also signs the person out everywhere
export const useSetBlocked = () =>
  useRefreshing(
    async ({ blocked, userId }: { userId: string; blocked: boolean }) => {
      const { error } = blocked
        ? await authClient.admin.banUser({
            banReason: 'Blocked from the admin page',
            userId,
          })
        : await authClient.admin.unbanUser({ userId })
      if (error !== null) {
        throw new Error(error.message ?? 'Could not change the block')
      }
    }
  )

export const useSetGenerationEnabled = () =>
  useRefreshing(
    async (generationEnabled: boolean) =>
      await call('/settings', {
        body: JSON.stringify({ generationEnabled }),
        method: 'PUT',
      })
  )
