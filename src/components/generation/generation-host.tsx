import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { markGuestSongUsed, useAccess } from '@/lib/auth'
import { STEPS } from '@/lib/generation/plan'
import type { Job } from '@/lib/generation/store'
import { focusedJob, useGeneration } from '@/lib/generation/store'
import { setLibrarySong } from '@/lib/react-query/queries-and-mutations'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

import type { Presentation } from './use-presentation'
import { usePresentation } from './use-presentation'

// The saved song's own data. The lyrics query never refetches on mount, so these are reset rather
// than invalidated: the next player to mount fetches the new lyrics instead of showing cached ones.
const SONG_QUERIES = [
  QUERY_KEYS.GET_LYRICS_BY_SONG_ID,
  QUERY_KEYS.GET_KARAOKE_BY_ID,
  QUERY_KEYS.GET_SONG_INFO_BY_SONG_ID,
  QUERY_KEYS.GET_LYRICS_VERSIONS,
]
// Lists that may now include the song. Not the library list: refetched now, it still lacks the song
const LIST_QUERIES = [QUERY_KEYS.SEARCH_VIDEOS, QUERY_KEYS.SEARCH_LIBRARY]

const announcementOf = (job: Job | null, view: Presentation | null) => {
  if (!job || !view) {
    return ''
  }
  if (job.status.kind === 'failed') {
    return `Lyrics generation failed: ${job.status.message}`
  }
  return view.revealed ? 'Lyrics ready' : STEPS[view.index].title
}

// Mounted once in the root layout, so every finished song refreshes its data on any page, and screen readers
// hear the song on show reach each step. What the generations look like is the top bar's (notifications.tsx)
const GenerationHost = () => {
  const generation = useGeneration()
  const { jobs } = generation
  const job = focusedJob(generation)
  const view = usePresentation(job)
  const queryClient = useQueryClient()
  // Every job that finishes refreshes its song, whichever one the panel shows, and today's song count
  const refreshed = useRef(new Set<string>())
  const access = useAccess()
  useEffect(() => {
    for (const done of jobs) {
      if (
        done.status.kind === 'failed' &&
        done.status.code === 'guest_limit' &&
        !refreshed.current.has(done.id)
      ) {
        refreshed.current.add(done.id)
        markGuestSongUsed()
      }
      if (done.status.kind !== 'complete' || refreshed.current.has(done.id)) {
        continue
      }
      refreshed.current.add(done.id)
      if (access.kind === 'guest' && done.mode === 'new') {
        markGuestSongUsed()
      }
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GET_ME] })
      for (const key of SONG_QUERIES) {
        void queryClient.resetQueries({ queryKey: [key, done.videoId] })
      }
      // The run hands over the timing it saved, so the player starts with karaoke even while the
      // lookup service that answers GET /karaoke is still starting up
      const { karaoke, outcome } = done.status
      if (karaoke) {
        queryClient.setQueryData(
          [QUERY_KEYS.GET_KARAOKE_BY_ID, done.videoId, null],
          karaoke
        )
      }
      // Its karaoke mark on every list; lyrics made live without timing lose it
      const live =
        outcome.kind === 'created' ||
        (outcome.kind === 'version' && outcome.active)
      if (done.video && (karaoke || live)) {
        setLibrarySong(queryClient, {
          author: done.video.channel,
          karaoke: karaoke !== null,
          thumbnailUrl: done.video.thumbnail,
          title: done.video.title,
          videoId: done.videoId,
        })
      }
      for (const key of LIST_QUERIES) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    }
  }, [access.kind, jobs, queryClient])

  const announcement = announcementOf(job, view)

  return (
    <p className='sr-only' aria-live='polite'>
      {announcement}
    </p>
  )
}

export default GenerationHost
