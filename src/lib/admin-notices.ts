import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { QUERY_KEYS } from '@/lib/react-query/query-keys'

// An admin's in-app notices (worker/src/notices.ts): recent contact messages, song reports, requests for more songs
// and feedback, unread until the admin opens the bell, gone 3 days after or at Clear Read. Read on open, on focus and
// every minute; nobody else asks
const noticesSchema = z.object({
  // Set by a Worker that takes POST /notices/clear; an older one leaves Clear Read out
  clearable: z.boolean().optional(),
  notices: z.array(
    z.object({
      at: z.number(),
      id: z.string(),
      kind: z.enum(['message', 'report', 'request', 'feedback']),
      name: z.string(),
      subject: z.string().nullable(),
      unread: z.boolean(),
      videoId: z.string().nullable(),
    })
  ),
  unread: z.number(),
})
export type AdminNotice = z.infer<typeof noticesSchema>['notices'][number]
type Notices = z.infer<typeof noticesSchema>

const EMPTY: Notices = { notices: [], unread: 0 }

const fetchNotices = async (): Promise<Notices> => {
  const response = await fetch('/api/admin/notices', {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(`/api/admin/notices answered ${response.status}`)
  }
  return noticesSchema.parse(await response.json())
}

export const useAdminNotices = (admin: boolean) => {
  const { data } = useQuery({
    enabled: admin,
    queryFn: fetchNotices,
    queryKey: [QUERY_KEYS.GET_ADMIN_NOTICES],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  return admin ? (data ?? EMPTY) : EMPTY
}

// Opening the bell reads them all: shown as read at once, then saved
export const useMarkNoticesSeen = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await fetch('/api/admin/notices/seen', {
        credentials: 'same-origin',
        method: 'POST',
      })
    },
    onMutate: () => {
      queryClient.setQueryData<Notices>(
        [QUERY_KEYS.GET_ADMIN_NOTICES],
        (old) =>
          old === undefined
            ? old
            : {
                ...old,
                notices: old.notices.map((n) => ({ ...n, unread: false })),
                unread: 0,
              }
      )
    },
  })
}

// Clear Read: the read ones leave the bell at once, then on the Worker; a failed save brings them back on the next read
export const useClearReadNotices = () => {
  const queryClient = useQueryClient()
  const queryKey = [QUERY_KEYS.GET_ADMIN_NOTICES]
  return useMutation({
    mutationFn: async () => {
      await fetch('/api/admin/notices/clear', {
        credentials: 'same-origin',
        method: 'POST',
      })
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<Notices>(queryKey, (old) =>
        old === undefined
          ? old
          : { ...old, notices: old.notices.filter((n) => n.unread) }
      )
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey })
    },
  })
}

// The open panel's record of a notice it found unread (GenerationState.unread)
export const noticeKey = (notice: AdminNotice) =>
  `notice:${notice.kind}:${notice.id}`

// Where each kind opens on /admin
export const NOTICE_TAB: Record<AdminNotice['kind'], string> = {
  feedback: 'feedback',
  message: 'messages',
  report: 'reports',
  request: 'requests',
}
