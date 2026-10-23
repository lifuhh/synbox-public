// Songs the signed-in listener reported that got new lyrics since (worker/src/reports.ts › listFixes). They sit in
// the top bar's notifications under the generations, quietly: no toast, no sound, the panel never opens for them.
// Seen and dismissed are kept by the Worker, so every device of the account agrees

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { z } from 'zod'

import { useMe } from '@/lib/auth'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

const fixSchema = z.object({
  fixedAt: z.number(),
  seen: z.boolean(),
  videoId: z.string(),
})
export type Fix = z.infer<typeof fixSchema>

type Mark = 'seen' | 'dismiss'

// What this device marked and the Worker may not have yet. A fetch answering in between would otherwise bring a
// dismissed row back, or the bell's count, for a moment
export const withPending = (
  fixes: readonly Fix[],
  pending: ReadonlyMap<string, Mark>
): Fix[] =>
  fixes
    .filter((fix) => pending.get(fix.videoId) !== 'dismiss')
    .map((fix) =>
      !fix.seen && pending.get(fix.videoId) === 'seen'
        ? { ...fix, seen: true }
        : fix
    )

export const unseenFixCount = (fixes: readonly Fix[]) =>
  fixes.filter((fix) => !fix.seen).length

const pending = new Map<string, Mark>()
const NONE: Fix[] = []

const fetchFixes = async () => {
  const response = await fetch('/api/me/fixes', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`/api/me/fixes answered ${response.status}`)
  }
  const { fixes } = z
    .object({ fixes: z.array(fixSchema) })
    .parse(await response.json())
  return withPending(fixes, pending)
}

const send = async (mark: Mark, fixes: readonly Fix[]) => {
  try {
    await fetch(`/api/me/fixes/${mark}`, {
      body: JSON.stringify({
        upTo: Math.max(...fixes.map((fix) => fix.fixedAt)),
        videoIds: fixes.map((fix) => fix.videoId),
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  } catch {
    // Offline: the next fetch shows the Worker's state again, and the next open marks it again
  }
}

// Fetched on load and whenever the app comes back to the front, like the account itself (useMe); the app polls
// nothing on a timer, so neither does this. A guest has none
export const useReportFixes = () => {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const userId = me?.user?.id ?? null
  const { data } = useQuery({
    enabled: userId !== null,
    queryFn: fetchFixes,
    queryKey: [QUERY_KEYS.GET_REPORT_FIXES, userId],
    staleTime: 30_000,
  })
  const fixes = userId === null ? NONE : (data ?? NONE)

  const apply = useCallback(
    async (mark: Mark, marked: readonly Fix[]) => {
      if (marked.length === 0) {
        return
      }
      const queryKey = [QUERY_KEYS.GET_REPORT_FIXES, userId]
      for (const fix of marked) {
        pending.set(fix.videoId, mark)
      }
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<Fix[]>(queryKey, (current) =>
        withPending(current ?? [], pending)
      )
      await send(mark, marked)
      for (const fix of marked) {
        // A dismiss sent meanwhile outlives this seen
        if (pending.get(fix.videoId) === mark) {
          pending.delete(fix.videoId)
        }
      }
      await queryClient.invalidateQueries({ queryKey })
    },
    [queryClient, userId]
  )

  return {
    // Takes fixes off the list here and on every device
    dismissFixes: useCallback(
      async (marked: readonly Fix[]) => {
        await apply('dismiss', marked)
      },
      [apply]
    ),
    fixes,
    // The panel is open on them: out of the bell's count, still listed
    markFixesSeen: useCallback(async () => {
      await apply(
        'seen',
        fixes.filter((fix) => !fix.seen)
      )
    }, [apply, fixes]),
  }
}
