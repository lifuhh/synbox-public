import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { authClient } from '@/lib/auth'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { fetchRecommendations } from '@/lib/recommendations'
import type { Recommendation } from '@/lib/recommendations'

// The auth Worker's /api/admin routes (worker/src/index.ts); each checks the admin role on the server

// D1 hands back Better Auth's dates as text or epoch milliseconds
const when = z.union([z.string(), z.number()])

// 'default' follows the Worker's USER_HOURLY_LIMIT; a number or 'unlimited' is an admin's override
const hourlyLimitSchema = z.union([
  z.number(),
  z.enum(['default', 'unlimited']),
])

const adminUserSchema = z.object({
  banned: z.union([z.number(), z.boolean()]).nullable(),
  createdAt: when,
  email: z.string(),
  hourlyLimit: hourlyLimitSchema,
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

const generationSchema = z.object({
  createdAt: z.number(),
  email: z.string().nullable(),
  errorCode: z.string().nullable(),
  // How far a running generation is, as the backend last reported: the stage's id and its fraction (0..1)
  fraction: z.number().nullable().optional(),
  // SQLite's boolean
  guest: z.union([z.number(), z.boolean()]),
  id: z.string(),
  kind: z.enum(['new', 'regenerate', 'retime']),
  name: z.string().nullable(),
  resultVersion: z.number().nullable(),
  stage: z.string().nullable().optional(),
  status: z.enum(['reserved', 'running', 'succeeded', 'failed']),
  videoId: z.string(),
})

export type HourlyLimit = z.infer<typeof hourlyLimitSchema>
export type AdminUser = z.infer<typeof adminUserSchema>
export type AdminGeneration = z.infer<typeof generationSchema>

const RUNNING_REFRESH_MS = 5000

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

export const useAdminGenerations = () =>
  useQuery({
    queryFn: async () =>
      z
        .object({ generations: z.array(generationSchema) })
        .parse(await call('/generations')).generations,
    queryKey: [QUERY_KEYS.GET_ADMIN_GENERATIONS],
    // Follows songs still running
    refetchInterval: (query) =>
      query.state.data?.some(
        (generation) =>
          generation.status === 'reserved' || generation.status === 'running'
      ) === true
        ? RUNNING_REFRESH_MS
        : false,
  })

// A listener's report of a song's lyrics (worker/src/reports.ts)
const reportSchema = z.object({
  atSeconds: z.number().nullable(),
  build: z.string().nullable(),
  client: z.string().nullable(),
  createdAt: z.number(),
  email: z.string().nullable(),
  // SQLite's boolean
  guest: z.union([z.number(), z.boolean()]),
  id: z.string(),
  message: z.string(),
  name: z.string().nullable(),
  version: z.number().nullable(),
  videoId: z.string(),
})
export type AdminReport = z.infer<typeof reportSchema>

export const useAdminReports = () =>
  useQuery({
    queryFn: async () =>
      z.object({ reports: z.array(reportSchema) }).parse(await call('/reports'))
        .reports,
    queryKey: [QUERY_KEYS.GET_ADMIN_REPORTS],
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

export const useSetHourlyLimit = () =>
  useRefreshing(
    async ({
      hourlyLimit,
      userId,
    }: {
      userId: string
      hourlyLimit: HourlyLimit
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

// The list as saved, in its order (the landing page shuffles it)
export const useAdminRecommendations = () =>
  useQuery({
    queryFn: async () => await fetchRecommendations({ fresh: true }),
    queryKey: [QUERY_KEYS.GET_ADMIN_RECOMMENDATIONS],
  })

// Replaces the whole list
export const useSaveRecommendations = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (songs: Recommendation[]) =>
      await call('/recommendations', {
        body: JSON.stringify({ songs }),
        method: 'PUT',
      }),
    onSuccess: async (_, songs) => {
      queryClient.setQueryData([QUERY_KEYS.GET_ADMIN_RECOMMENDATIONS], songs)
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST],
      })
    },
  })
}
