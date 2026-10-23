import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { call } from '@/lib/admin'
import { authClient } from '@/lib/auth'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { listLyricsVersions } from '@/lib/synbox-flask/lyrics-versions'
import type { LyricsVersionSummary } from '@/lib/synbox-flask/lyrics-versions'

// What only the admin page reads and changes: accounts, the generation ledger, reports and settings. Apart from
// lib/admin (recommendations, which the watch page's Save to Playlist uses too), so it loads with /admin only

// D1 hands back Better Auth's dates as text or epoch milliseconds
const when = z.union([z.string(), z.number()])

// 'default' follows the Worker's USER_DAILY_LIMIT; a number or 'unlimited' is an admin's override
const dailyLimitSchema = z.union([z.number(), z.enum(['default', 'unlimited'])])

// A Worker from before migration 0013 still sends the hourly names; read them as the daily ones
const adminUserSchema = z.preprocess(
  (row) =>
    typeof row === 'object' && row !== null
      ? {
          dailyLimit: 'hourlyLimit' in row ? row.hourlyLimit : undefined,
          songsLastDay: 'songsLastHour' in row ? row.songsLastHour : undefined,
          ...row,
        }
      : row,
  z.object({
    banned: z.union([z.number(), z.boolean()]).nullable(),
    createdAt: when,
    dailyLimit: dailyLimitSchema,
    email: z.string(),
    id: z.string(),
    image: z.string().nullable(),
    lastSeenAt: when.nullable(),
    name: z.string(),
    role: z.string().nullable(),
    songsLastDay: z.number(),
    songsTotal: z.number(),
  })
)

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

export type DailyLimit = z.infer<typeof dailyLimitSchema>
export type AdminUser = z.infer<typeof adminUserSchema>
export type AdminGeneration = z.infer<typeof generationSchema>

const RUNNING_REFRESH_MS = 5000

export const useAdminUsers = () =>
  useQuery({
    queryFn: async () =>
      z.object({ users: z.array(adminUserSchema) }).parse(await call('/users'))
        .users,
    queryKey: [QUERY_KEYS.GET_ADMIN_USERS],
  })

// Whose songs the Songs list shows: everyone (null), guests, or one account by email
export const GUESTS = 'guest'
export type SongsBy = string | null

const isBy = (generation: AdminGeneration, by: SongsBy) => {
  if (by === null) {
    return true
  }
  const guest = generation.guest === 1 || generation.guest === true
  return by === GUESTS ? guest : !guest && generation.email === by
}

// The Worker filters the whole ledger by `user`; the filter here keeps the list right against a Worker that
// predates it and answers with everyone's latest
export const useAdminGenerations = (by: SongsBy) =>
  useQuery({
    queryFn: async () =>
      z
        .object({ generations: z.array(generationSchema) })
        .parse(
          await call(
            by === null
              ? '/generations'
              : `/generations?user=${encodeURIComponent(by)}`
          )
        )
        .generations.filter((generation) => isBy(generation, by)),
    queryKey: [QUERY_KEYS.GET_ADMIN_GENERATIONS, by],
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
  // Null unless dropped, absent from a Worker before migration 0017
  dropReason: z.string().nullable().optional(),
  droppedAt: z.number().nullable().optional(),
  email: z.string().nullable(),
  // SQLite's boolean
  guest: z.union([z.number(), z.boolean()]),
  id: z.string(),
  message: z.string(),
  name: z.string().nullable(),
  // Null while open, absent from a Worker before migration 0015. The closing note of a resolve or a drop
  resolution: z.string().nullable().optional(),
  resolvedAt: z.number().nullable().optional(),
  resolvedVersion: z.number().nullable().optional(),
  version: z.number().nullable(),
  videoId: z.string(),
})
export type AdminReport = z.infer<typeof reportSchema>

export const isResolved = (report: AdminReport) =>
  report.resolvedAt !== null && report.resolvedAt !== undefined

export type ReportState = 'open' | 'resolved' | 'dropped'

export const reportState = (report: AdminReport): ReportState => {
  if (isResolved(report)) {
    return 'resolved'
  }
  return report.droppedAt === null || report.droppedAt === undefined
    ? 'open'
    : 'dropped'
}

// Why a report was closed without a fix (worker/src/reports.ts › DROP_REASONS). Expired is the daily cron's alone
export const DROP_REASONS = {
  duplicate: 'Duplicate',
  expired: 'Expired',
  no_lyrics: 'No Lyrics',
  nothing_found: 'Nothing Found',
  uninformative: 'Uninformative',
} as const
export type DropReason = keyof typeof DROP_REASONS
export const MANUAL_DROP_REASONS: DropReason[] = [
  'uninformative',
  'no_lyrics',
  'duplicate',
  'nothing_found',
]

const isDropReason = (reason: unknown): reason is DropReason =>
  typeof reason === 'string' && Object.hasOwn(DROP_REASONS, reason)

export const dropReasonLabel = (reason: string | null | undefined) =>
  isDropReason(reason) ? DROP_REASONS[reason] : null

export const useAdminReports = () =>
  useQuery({
    queryFn: async () =>
      z.object({ reports: z.array(reportSchema) }).parse(await call('/reports'))
        .reports,
    queryKey: [QUERY_KEYS.GET_ADMIN_REPORTS],
  })

const LIVE_VERSION_WAIT_MS = 4000

// The version a listener saw when they reported: the newest saved by then, since a new version goes live at once.
// Null when none was saved by then. A rollback before the report makes this a guess; nothing records which
// version was live at a moment
export const versionLiveAt = (
  versions: readonly Pick<LyricsVersionSummary, 'version' | 'created_at'>[],
  at: number
) => {
  let live: number | null = null
  for (const { version, created_at } of versions) {
    if (Date.parse(created_at) <= at && (live === null || version > live)) {
      live = version
    }
  }
  return live
}

// The song's live lyrics version, recorded as the one that fixed a report: an admin resolves once the fix is
// live. A listener's report carries no version, so it also gets the one live when it was sent: the reporter hears
// of the fix only when the two differ (worker/src/reports.ts › listFixes). Both null when the lyrics server can't
// say in a few seconds, so resolving never waits on it
const resolutionOf = async (report: AdminReport) => {
  try {
    const { active, versions } = await listLyricsVersions(
      report.videoId,
      AbortSignal.timeout(LIVE_VERSION_WAIT_MS)
    )
    return {
      reportedVersion:
        report.version ?? versionLiveAt(versions, report.createdAt),
      version: active,
    }
  } catch {
    return { reportedVersion: null, version: null }
  }
}

// Resolve, reopen (a resolved or dropped report), or drop with a reason
export type ReportChange = 'resolve' | 'reopen' | { drop: DropReason }

const bodyOf = async (report: AdminReport, change: ReportChange) => {
  if (change === 'resolve') {
    return await resolutionOf(report)
  }
  return change === 'reopen' ? {} : { reason: change.drop }
}

export const useChangeReport = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      report,
      change,
    }: {
      report: AdminReport
      change: ReportChange
    }) =>
      await call(
        `/reports/${encodeURIComponent(report.id)}/${typeof change === 'string' ? change : 'drop'}`,
        {
          body: JSON.stringify(await bodyOf(report, change)),
          method: 'POST',
        }
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_ADMIN_REPORTS],
      })
    },
  })
}

// Leads on someone working around the song limit, from the last 7 days (worker/src/signals.ts)
const flagSchema = z.enum([
  'automated',
  'shared_network',
  'new_at_limit',
  'refused',
])
const signalsSchema = z.object({
  accounts: z.array(
    z.object({
      client: z.string().nullable(),
      createdAt: z.number(),
      email: z.string(),
      flags: z.array(flagSchema),
      id: z.string(),
      name: z.string(),
      refusals: z.number(),
      songs: z.number(),
    })
  ),
  networks: z.array(
    z.object({
      accounts: z.array(
        z.object({ email: z.string(), id: z.string(), name: z.string() })
      ),
      automated: z.boolean(),
      guestSongs: z.number(),
      key: z.string(),
      refusals: z.number(),
      songs: z.number(),
    })
  ),
})
export type SignalFlag = z.infer<typeof flagSchema>
export type AdminSignals = z.infer<typeof signalsSchema>

export const useAdminSignals = () =>
  useQuery({
    queryFn: async () => signalsSchema.parse(await call('/signals')),
    queryKey: [QUERY_KEYS.GET_ADMIN_SIGNALS],
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

export const useSetDailyLimit = () =>
  useRefreshing(
    async ({
      dailyLimit,
      userId,
    }: {
      userId: string
      dailyLimit: DailyLimit
    }) =>
      await call(`/users/${encodeURIComponent(userId)}/limit`, {
        // hourlyLimit: the same value for a Worker from before migration 0013
        body: JSON.stringify({ dailyLimit, hourlyLimit: dailyLimit }),
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
