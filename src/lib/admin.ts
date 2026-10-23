import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import {
  fetchRecommendations,
  MAX_RECOMMENDATIONS,
} from '@/lib/recommendations'
import type { Recommendation } from '@/lib/recommendations'

// The auth Worker's /api/admin routes (worker/src/index.ts); each checks the admin role on the server

export const call = async (
  path: string,
  init: RequestInit = {}
): Promise<unknown> => {
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

export class RecommendationsFullError extends Error {
  override name = 'RecommendationsFullError'
}

// Adds one song to the end of the list as it is saved now, not as this page last loaded it, so it never undoes
// another edit. A song already in the list is left where it is
export const useAddRecommendation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (song: Recommendation) => {
      const songs = await fetchRecommendations({ fresh: true })
      if (songs.some((saved) => saved.videoId === song.videoId)) {
        return songs
      }
      if (songs.length >= MAX_RECOMMENDATIONS) {
        throw new RecommendationsFullError()
      }
      const next = [...songs, song]
      await call('/recommendations', {
        body: JSON.stringify({ songs: next }),
        method: 'PUT',
      })
      return next
    },
    onSuccess: async (songs) => {
      queryClient.setQueryData([QUERY_KEYS.GET_ADMIN_RECOMMENDATIONS], songs)
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST],
      })
    },
  })
}

// The error a removal answers with when the song is the list's last
export const LAST_RECOMMENDATION = 'Recommended keeps at least one song'

// Takes one song out of the list as it is saved now, not as this page last loaded it, so it never undoes another
// edit. The list keeps at least one song, as the admin page's editor does
export const useRemoveRecommendation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (videoId: string) => {
      const songs = await fetchRecommendations({ fresh: true })
      const next = songs.filter((saved) => saved.videoId !== videoId)
      if (next.length === songs.length) {
        return songs
      }
      if (next.length === 0) {
        throw new Error(LAST_RECOMMENDATION)
      }
      await call('/recommendations', {
        body: JSON.stringify({ songs: next }),
        method: 'PUT',
      })
      return next
    },
    onSuccess: async (songs) => {
      queryClient.setQueryData([QUERY_KEYS.GET_ADMIN_RECOMMENDATIONS], songs)
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST],
      })
    },
  })
}
