import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { call } from '@/lib/admin'
import { AdminApiError } from '@/lib/admin-api-error'
import { authClient } from '@/lib/auth'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { listLyricsVersions } from '@/lib/synbox-flask/lyrics-versions'
import type {
  LyricsVersionSummary,
  LyricsVersionsResponse,
} from '@/lib/synbox-flask/lyrics-versions'

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
          // A Worker from before accountStats: its last session refresh, and no plays kept
          lastActiveAt: 'lastSeenAt' in row ? row.lastSeenAt : undefined,
          lastPlayAt: null,
          plays: 0,
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
    lastActiveAt: when.nullable(),
    lastPlayAt: when.nullable(),
    name: z.string(),
    // Counted plays: every visit to a song, a reload within a minute excepted, as songs are counted (worker songs.ts › addListen)
    plays: z.number(),
    role: z.string().nullable(),
    songsLastDay: z.number(),
    songsTotal: z.number(),
  })
)

const settingsSchema = z.object({
  // Set while the site's daily ceiling paused generation (not the owner): when, and the songs it counted. Both
  // optional for a Worker from before migration 0032
  autoPause: z.object({ at: z.number(), count: z.number() }).nullish(),
  generationEnabled: z.boolean(),
  limits: z.object({ site: z.number().optional(), user: z.number() }),
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

// The Worker answered in a shape this page doesn't know: the page is from another deploy than the Worker (an
// installed app keeps its version until a page change), so reloading fixes it
export class AdminOutdatedError extends Error {
  override name = 'AdminOutdatedError'
}

const fetchParsed = async <T>(schema: z.ZodType<T>, path: string) => {
  const result = schema.safeParse(await call(path))
  if (!result.success) {
    console.error(`/api/admin${path}`, result.error.issues)
    throw new AdminOutdatedError('Page out of date')
  }
  return result.data
}

// How often a failed read is asked again before its error shows. A Worker that answered mostly answers the same
// again: a refusal (4xx) or an out-of-date shape never, a server error (5xx) once, so the error shows in about a
// second, not after 4 asks over 8 (a 500 from a query its database couldn't run, 2026-11-28). A request that got
// no answer keeps React Query's 3
const retry = (failures: number, error: Error) => {
  if (error instanceof AdminOutdatedError) {
    return false
  }
  if (error instanceof AdminApiError) {
    return error.status >= 500 && failures < 1
  }
  return failures < 3
}

export type DailyLimit = z.infer<typeof dailyLimitSchema>
export type AdminUser = z.infer<typeof adminUserSchema>
export type AdminGeneration = z.infer<typeof generationSchema>

const RUNNING_REFRESH_MS = 5000

export const useAdminUsers = () =>
  useQuery({
    queryFn: async () => {
      const { users } = await fetchParsed(
        z.object({ users: z.array(adminUserSchema) }),
        '/users'
      )
      return users
    },
    queryKey: [QUERY_KEYS.GET_ADMIN_USERS],
    retry,
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
    queryFn: async () => {
      const { generations } = await fetchParsed(
        z.object({ generations: z.array(generationSchema) }),
        by === null
          ? '/generations'
          : `/generations?user=${encodeURIComponent(by)}`
      )
      return generations.filter((generation) => isBy(generation, by))
    },
    queryKey: [QUERY_KEYS.GET_ADMIN_GENERATIONS, by],
    // Follows songs still running
    refetchInterval: (query) =>
      query.state.data?.some(
        (generation) =>
          generation.status === 'reserved' || generation.status === 'running'
      ) === true
        ? RUNNING_REFRESH_MS
        : false,
    retry,
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
  // Set when the backend's fixer couldn't fix it and left it for a human, with why; absent before migration 0025
  reviewAt: z.number().nullable().optional(),
  reviewNote: z.string().nullable().optional(),
  version: z.number().nullable(),
  videoId: z.string(),
})
export type AdminReport = z.infer<typeof reportSchema>

export const isResolved = (report: AdminReport) =>
  report.resolvedAt !== null && report.resolvedAt !== undefined

export type ReportState = 'open' | 'review' | 'resolved' | 'dropped'

// Review is still open for its reporter: only the fixer has given up on it
export const reportState = (report: AdminReport): ReportState => {
  if (isResolved(report)) {
    return 'resolved'
  }
  if (report.droppedAt !== null && report.droppedAt !== undefined) {
    return 'dropped'
  }
  return report.reviewAt === null || report.reviewAt === undefined
    ? 'open'
    : 'review'
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

// Every report not deleted, by state, past the list's limit; absent from a Worker before 2026-11-19
const reportCountsSchema = z.object({
  dropped: z.number(),
  open: z.number(),
  resolved: z.number(),
  review: z.number(),
})
export type ReportCounts = z.infer<typeof reportCountsSchema>

export const REPORTS_LIMIT = 200

// The latest `limit` reports, open ones first, and the counts. Show More asks for a longer list; the shorter one
// stays on screen until it comes
export const useAdminReports = (limit = REPORTS_LIMIT) =>
  useQuery({
    placeholderData: keepPreviousData,
    queryFn: async () =>
      await fetchParsed(
        z.object({
          counts: reportCountsSchema.optional(),
          reports: z.array(reportSchema),
        }),
        limit === REPORTS_LIMIT ? '/reports' : `/reports?limit=${limit}`
      ),
    queryKey: [QUERY_KEYS.GET_ADMIN_REPORTS, limit],
    retry,
  })

// The version a fix by hand made live after the fixer handed the report to a human: the song's live version, when
// it was made after reviewAt. The backend's fixer resolves such a report at its next run, by the same rule; a
// rollback to a version made before then is no fix. Null while the versions load, or when there is no such fix
export const fixedVersion = (
  report: AdminReport,
  lyrics: Pick<LyricsVersionsResponse, 'active' | 'versions'> | undefined
) => {
  if (
    lyrics === undefined ||
    lyrics.active === null ||
    report.reviewAt === null ||
    report.reviewAt === undefined
  ) {
    return null
  }
  const live = lyrics.versions.find(({ version }) => version === lyrics.active)
  return live !== undefined && Date.parse(live.created_at) > report.reviewAt
    ? lyrics.active
    : null
}

// Report id → the version that fixed it, for the Needs Review reports only (a few): each song's versions come from
// the lookup service one song a call, under the same key as useGetLyricsVersions, so the two share them
export const useFixedVersions = (reports: readonly AdminReport[]) => {
  const review = reports.filter((report) => reportState(report) === 'review')
  const videoIds = [...new Set(review.map((report) => report.videoId))]
  const versions = useQueries({
    queries: videoIds.map((videoId) => ({
      queryFn: async () => await listLyricsVersions(videoId),
      queryKey: [QUERY_KEYS.GET_LYRICS_VERSIONS, videoId],
      retry: false,
    })),
  })
  const byVideo = new Map(
    videoIds.map((videoId, i) => [videoId, versions[i]?.data])
  )
  return new Map(
    review.flatMap((report) => {
      const version = fixedVersion(report, byVideo.get(report.videoId))
      return version === null ? [] : [[report.id, version] as const]
    })
  )
}

// What a Delete changes: its list, and the admin's bell, which leaves deleted rows out too
const DELETABLE = {
  feedback: { key: QUERY_KEYS.GET_ADMIN_FEEDBACK, path: '/feedback' },
  message: { key: QUERY_KEYS.GET_ADMIN_MESSAGES, path: '/messages' },
  report: { key: QUERY_KEYS.GET_ADMIN_REPORTS, path: '/reports' },
} as const
export type DeletableKind = keyof typeof DELETABLE
export type Deletable =
  | { kind: 'report'; id: string }
  | { kind: 'feedback' | 'message'; id: number }

const refreshAfterDelete = async (
  queryClient: QueryClient,
  kind: DeletableKind
) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [DELETABLE[kind].key] }),
    queryClient.invalidateQueries({
      queryKey: [QUERY_KEYS.GET_ADMIN_NOTICES],
    }),
  ])
}

// Deletes one closed report, one feedback or one message (worker/src/deleted.ts); Undo is useRestoreDeleted
export const useDeleteRow = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ kind, id }: Deletable) =>
      await call(`${DELETABLE[kind].path}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSettled: async (_data, _error, { kind }) => {
      await refreshAfterDelete(queryClient, kind)
    },
  })
}

// Clear All on the Dropped tab; answers the ids it deleted, for Undo
export const useClearDropped = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      z
        .object({ ids: z.array(z.string()) })
        .parse(
          await call('/reports/clear-dropped', { body: '{}', method: 'POST' })
        ).ids,
    onSettled: async () => {
      await refreshAfterDelete(queryClient, 'report')
    },
  })
}

// Undo of a delete. A plain function, not a mutation: the toast that calls it outlives the row that offered it.
// Never throws: a failure goes to onError
export const useRestoreDeleted = (onError: (error: Error) => void) => {
  const queryClient = useQueryClient()
  return async (kind: DeletableKind, ids: readonly (string | number)[]) => {
    try {
      await call(`${DELETABLE[kind].path}/restore`, {
        body: JSON.stringify({ ids }),
        method: 'POST',
      })
    } catch (error) {
      onError(error instanceof Error ? error : new Error('Undo failed'))
    }
    await refreshAfterDelete(queryClient, kind)
  }
}

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
    queryFn: async () => await fetchParsed(signalsSchema, '/signals'),
    queryKey: [QUERY_KEYS.GET_ADMIN_SIGNALS],
    retry,
  })

// How the app is used: the last 14 UTC days, the past 7 days' totals and events, the most listened songs
// (worker/src/events.ts › readUsage)
const usageSchema = z.object({
  days: z.array(
    z.object({
      active: z.number(),
      day: z.string(),
      generations: z.number(),
      generationsFailed: z.number(),
      newAccounts: z.number(),
      reports: z.number(),
      signedIn: z.number(),
      songOpens: z.number(),
    })
  ),
  events: z.array(
    z.object({ actors: z.number(), count: z.number(), name: z.string() })
  ),
  // The latest song opens, newest first: who (an account's name, or "Guest" and its browser's short id) and when.
  // Missing from a Worker older than 2026-11-13
  plays: z
    .array(
      z.object({
        at: z.number(),
        by: z.string(),
        guest: z.boolean(),
        videoId: z.string(),
      })
    )
    .default([]),
  songs: z.array(z.object({ listens: z.number(), videoId: z.string() })),
  week: z.object({ active: z.number(), signedIn: z.number() }),
})
export type AdminUsage = z.infer<typeof usageSchema>

export const useAdminUsage = () =>
  useQuery({
    queryFn: async () => await fetchParsed(usageSchema, '/usage'),
    queryKey: [QUERY_KEYS.GET_ADMIN_USAGE],
    retry,
  })

// Contact form messages, newest first (worker/src/contact.ts). emailError says why one wasn't emailed
const messagesSchema = z.object({
  messages: z.array(
    z.object({
      accountEmail: z.string().nullable(),
      accountName: z.string().nullable(),
      createdAt: z.number(),
      emailError: z.string().nullable(),
      emailedAt: z.number().nullable(),
      id: z.number(),
      message: z.string(),
      replyTo: z.string().nullable(),
      sender: z.string().nullable(),
      subject: z.string(),
    })
  ),
})
export type AdminMessage = z.infer<typeof messagesSchema>['messages'][number]

export const useAdminMessages = () =>
  useQuery({
    queryFn: async () => await fetchParsed(messagesSchema, '/messages'),
    queryKey: [QUERY_KEYS.GET_ADMIN_MESSAGES],
    retry,
  })

// Send Feedback, open first, then newest (worker/src/feedback.ts). An anonymous one has no name or email
const feedbackSchema = z.object({
  feedback: z.array(
    z.object({
      // SQLite's boolean
      anonymous: z.union([z.number(), z.boolean()]),
      createdAt: z.number(),
      droppedAt: z.number().nullable(),
      email: z.string().nullable(),
      id: z.number(),
      message: z.string(),
      name: z.string().nullable(),
      resolvedAt: z.number().nullable(),
      subject: z.string(),
    })
  ),
})
export type AdminFeedback = z.infer<typeof feedbackSchema>['feedback'][number]
export type FeedbackState = 'open' | 'resolved' | 'dropped'
export type FeedbackChange = 'resolve' | 'drop' | 'reopen'

export const feedbackState = (feedback: AdminFeedback): FeedbackState => {
  if (feedback.resolvedAt !== null) {
    return 'resolved'
  }
  return feedback.droppedAt === null ? 'open' : 'dropped'
}

export const useAdminFeedback = () =>
  useQuery({
    queryFn: async () => await fetchParsed(feedbackSchema, '/feedback'),
    queryKey: [QUERY_KEYS.GET_ADMIN_FEEDBACK],
    retry,
  })

// Resolve (a signed sender hears of it in the app), drop (nobody does) or reopen; each one press, undone by Reopen
export const useChangeFeedback = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      change,
    }: {
      id: number
      change: FeedbackChange
    }) =>
      await call(`/feedback/${id}/${change}`, { body: '{}', method: 'POST' }),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_ADMIN_FEEDBACK],
      })
    },
  })
}

// Requests for more songs a day, open ones first (worker/src/requests.ts)
const requestsSchema = z.object({
  requests: z.array(
    z.object({
      createdAt: z.number(),
      dailyLimit: dailyLimitSchema,
      decidedAt: z.number().nullable(),
      email: z.string(),
      granted: z.number().nullable(),
      id: z.number(),
      image: z.string().nullable(),
      name: z.string(),
      note: z.string(),
      status: z.enum(['open', 'approved', 'declined']),
      userId: z.string(),
    })
  ),
})
export type AdminRequest = z.infer<typeof requestsSchema>['requests'][number]

export const useAdminRequests = () =>
  useQuery({
    queryFn: async () => await fetchParsed(requestsSchema, '/quota-requests'),
    queryKey: [QUERY_KEYS.GET_ADMIN_REQUESTS],
    retry,
  })

// Approve with a number of songs a day, or decline; the request list and the accounts' limits both change
export const useDecideRequest = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      dailyLimit,
    }: {
      id: number
      dailyLimit: number | null
    }) =>
      await call(
        `/quota-requests/${id}/${dailyLimit === null ? 'decline' : 'approve'}`,
        {
          body: JSON.stringify(dailyLimit === null ? {} : { dailyLimit }),
          method: 'POST',
        }
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_ADMIN_REQUESTS],
      })
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_ADMIN_USERS],
      })
    },
  })
}

export const useAdminSettings = () =>
  useQuery({
    queryFn: async () => await fetchParsed(settingsSchema, '/settings'),
    queryKey: [QUERY_KEYS.GET_ADMIN_SETTINGS],
    retry,
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
