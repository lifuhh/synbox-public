import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { QUERY_KEYS } from '@/lib/react-query/query-keys'

// Each song's listens and likes, kept by the auth Worker (worker/src/songs.ts)

// A guest's likes belong to this browser: a random id kept here, never synced to an account
const DEVICE_KEY = 'synboxDevice'
export const deviceId = () => {
  try {
    const kept = localStorage.getItem(DEVICE_KEY)
    if (kept !== null) {
      return kept
    }
    const id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
    return id
  } catch {
    return null
  }
}

// A visit to the song's player page. One per visit: a remount within a few seconds (React's development double
// run, a quick back and forth) is the same visit
const SAME_VISIT_MS = 5000
let lastListen = { at: 0, videoId: '' }
// The listen each song's page sent, until the Worker has it: the song's stats wait for it, so the count shown
// already holds this visit (a first listener reads 1 listen, not 0)
const sending = new Map<string, Promise<void>>()
export const countListen = (videoId: string) => {
  const now = Date.now()
  if (lastListen.videoId === videoId && now - lastListen.at < SAME_VISIT_MS) {
    return
  }
  lastListen = { at: now, videoId }
  const send = async () => {
    try {
      await fetch(`/api/songs/${videoId}/listen`, {
        keepalive: true,
        method: 'POST',
      })
    } catch {
      // A listen that doesn't arrive is one fewer in the count, nothing more
    }
  }
  sending.set(videoId, send())
}

const statsSchema = z.object({
  liked: z.boolean(),
  likes: z.number(),
  listens: z.number(),
})
export type SongStats = z.infer<typeof statsSchema>

const statsKey = (videoId: string) => [QUERY_KEYS.GET_SONG_STATS, videoId]

const readJson = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`Song stats answered ${response.status}`)
  }
  return statsSchema.parse(await response.json())
}

export const useSongStats = (videoId: string) =>
  useQuery({
    enabled: videoId !== '',
    queryFn: async () => {
      await sending.get(videoId)
      return await readJson(
        await fetch(`/api/songs/${videoId}/stats?device=${deviceId() ?? ''}`, {
          credentials: 'same-origin',
        })
      )
    },
    queryKey: statsKey(videoId),
  })

// Shows the like at once and settles on the server's answer; a refused like puts the button back
export const useLikeSong = (videoId: string) => {
  const queryClient = useQueryClient()
  return useMutation<
    SongStats,
    Error,
    boolean,
    { before: SongStats | undefined }
  >({
    mutationFn: async (liked: boolean) =>
      await readJson(
        await fetch(`/api/songs/${videoId}/like`, {
          body: JSON.stringify({ device: deviceId(), liked }),
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        })
      ),
    onError: (_error, _liked, context) => {
      queryClient.setQueryData(statsKey(videoId), context?.before)
    },
    onMutate: async (liked) => {
      await queryClient.cancelQueries({ queryKey: statsKey(videoId) })
      const before = queryClient.getQueryData<SongStats>(statsKey(videoId))
      if (before && before.liked !== liked) {
        queryClient.setQueryData<SongStats>(statsKey(videoId), {
          ...before,
          liked,
          likes: before.likes + (liked ? 1 : -1),
        })
      }
      return { before }
    },
    onSuccess: (stats) => {
      queryClient.setQueryData(statsKey(videoId), stats)
    },
  })
}

const recentSchema = z.object({ videoIds: z.array(z.string()) })

// The songs anyone played most recently, latest first: video ids only, any video (the caller keeps its library's)
export const useRecentListens = () =>
  useQuery({
    queryFn: async () => {
      const response = await fetch('/api/songs/recent')
      if (!response.ok) {
        throw new Error(`Recent listens answered ${response.status}`)
      }
      return recentSchema.parse(await response.json()).videoIds
    },
    queryKey: [QUERY_KEYS.GET_RECENT_LISTENS],
    // The Worker's answer is cached for a minute anyway
    staleTime: 60_000,
  })

const countsSchema = z.object({ listens: z.record(z.string(), z.number()) })

// The listens of the songs played often enough to show a count on their cards (the Worker leaves out the rest)
export const useListenCounts = () =>
  useQuery({
    queryFn: async () => {
      const response = await fetch('/api/songs/listens')
      if (!response.ok) {
        throw new Error(`Listen counts answered ${response.status}`)
      }
      return countsSchema.parse(await response.json()).listens
    },
    queryKey: [QUERY_KEYS.GET_LISTEN_COUNTS],
    // The Worker's answer is cached for five minutes anyway
    staleTime: 300_000,
  })

const compact = new Intl.NumberFormat('en', { notation: 'compact' })
export const compactCount = (count: number) => compact.format(count)
// "1 listen", "980 listens", "1.2K listens"
export const listensText = (listens: number) =>
  `${compact.format(listens)} ${listens === 1 ? 'listen' : 'listens'}`
