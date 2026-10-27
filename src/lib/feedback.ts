// Send Feedback (worker/src/feedback.ts): a subject and a message about the app, from an account or a guest. An
// account may send it anonymously; a guest's always is. Signed feedback, once an admin resolves it, comes back in the
// top bar's notifications under Feedback Resolved, the way a fixed report does (lib/report-fixes.ts): quietly, seen
// and dismissed kept by the Worker so every device agrees

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { z } from 'zod'

import { useMe } from '@/lib/auth'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

// The secondary line beside each way to write, in the menus: what Send Feedback is for, and how Contact Me answers
export const WRITE_HINTS = {
  contact: 'Replies by email',
  feedback: 'Bugs or ideas',
} as const

export const SUBJECT_MAX = 120
export const MESSAGE_MAX = 4000

export interface FeedbackRequest {
  subject: string
  message: string
  anonymous: boolean
  // The hidden field only bots fill in
  website: string
}

export type FeedbackResult =
  | 'sent'
  | 'limit'
  | 'invalid'
  | 'signed_out'
  | 'failed'

export const sendFeedback = async (
  request: FeedbackRequest
): Promise<FeedbackResult> => {
  try {
    const response = await fetch('/api/feedback', {
      body: JSON.stringify(request),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    if (response.ok) {
      return 'sent'
    }
    if (response.status === 429) {
      return 'limit'
    }
    if (response.status === 401) {
      return 'signed_out'
    }
    return response.status === 400 ? 'invalid' : 'failed'
  } catch {
    return 'failed'
  }
}

const resolvedSchema = z.object({
  id: z.number(),
  resolvedAt: z.number(),
  seen: z.boolean(),
  subject: z.string(),
})
export type ResolvedFeedback = z.infer<typeof resolvedSchema>

type Mark = 'seen' | 'dismiss'

// What this device marked and the Worker may not have yet, as report-fixes.ts › withPending
export const withPendingMarks = (
  items: readonly ResolvedFeedback[],
  pending: ReadonlyMap<number, Mark>
): ResolvedFeedback[] =>
  items
    .filter((item) => pending.get(item.id) !== 'dismiss')
    .map((item) =>
      !item.seen && pending.get(item.id) === 'seen'
        ? { ...item, seen: true }
        : item
    )

const pending = new Map<number, Mark>()
// Marked seen once a visit: a Worker that answers unseen again (its write lost, or offline) is not asked again on every
// fetch, which the open panel's effect would otherwise do in a loop
const sentSeen = new Set<number>()
const NONE: ResolvedFeedback[] = []

// A Worker without the route (deployed after this build) answers 404: nothing to show
const fetchResolved = async () => {
  const response = await fetch('/api/me/feedback', {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(`/api/me/feedback answered ${response.status}`)
  }
  const { feedback } = z
    .object({ feedback: z.array(resolvedSchema) })
    .parse(await response.json())
  return withPendingMarks(feedback, pending)
}

const send = async (mark: Mark, items: readonly ResolvedFeedback[]) => {
  try {
    await fetch(`/api/me/feedback/${mark}`, {
      body: JSON.stringify({
        ids: items.map((item) => item.id),
        upTo: Math.max(...items.map((item) => item.resolvedAt)),
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  } catch {
    // Offline: the next fetch shows the Worker's state again, and the next open marks it again
  }
}

// Fetched like the fixes: on load and when the app comes back to the front. A guest has none
export const useResolvedFeedback = () => {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const userId = me?.user?.id ?? null
  const { data } = useQuery({
    enabled: userId !== null,
    queryFn: fetchResolved,
    queryKey: [QUERY_KEYS.GET_RESOLVED_FEEDBACK, userId],
    retry: false,
    staleTime: 30_000,
  })
  const resolved = userId === null ? NONE : (data ?? NONE)

  const apply = useCallback(
    async (mark: Mark, marked: readonly ResolvedFeedback[]) => {
      if (marked.length === 0) {
        return
      }
      const queryKey = [QUERY_KEYS.GET_RESOLVED_FEEDBACK, userId]
      for (const item of marked) {
        pending.set(item.id, mark)
      }
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<ResolvedFeedback[]>(queryKey, (current) =>
        withPendingMarks(current ?? [], pending)
      )
      await send(mark, marked)
      for (const item of marked) {
        if (pending.get(item.id) === mark) {
          pending.delete(item.id)
        }
      }
      await queryClient.invalidateQueries({ queryKey })
    },
    [queryClient, userId]
  )

  return {
    dismissResolved: useCallback(
      async (marked: readonly ResolvedFeedback[]) => {
        await apply('dismiss', marked)
      },
      [apply]
    ),
    markResolvedSeen: useCallback(async () => {
      const unseen = resolved.filter(
        (item) => !item.seen && !sentSeen.has(item.id)
      )
      for (const item of unseen) {
        sentSeen.add(item.id)
      }
      await apply('seen', unseen)
    }, [apply, resolved]),
    resolved,
  }
}
