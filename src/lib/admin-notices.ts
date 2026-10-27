import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { QUERY_KEYS } from '@/lib/react-query/query-keys'

// An admin's in-app notices (worker/src/notices.ts): new contact messages, song reports and requests for more
// songs, unread until the admin opens the bell. Read on open, on focus and every minute; nobody else asks
const noticesSchema = z.object({
  notices: z.array(
    z.object({
      at: z.number(),
      id: z.string(),
      kind: z.enum(['message', 'report', 'request']),
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
                notices: old.notices.map((n) => ({ ...n, unread: false })),
                unread: 0,
              }
      )
    },
  })
}

// Where each kind opens on /admin
export const NOTICE_TAB: Record<AdminNotice['kind'], string> = {
  message: 'messages',
  report: 'reports',
  request: 'requests',
}
