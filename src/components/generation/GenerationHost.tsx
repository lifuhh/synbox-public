import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { useMatch } from 'react-router'

import { STEPS } from '@/lib/generation/plan'
import { useGeneration } from '@/lib/generation/store'
import { QUERY_KEYS } from '@/lib/react-query/queryKeys'

import GenerationFab from './GenerationFab'
import GenerationPanel from './GenerationPanel'
import { usePresentation } from './usePresentation'

// The saved song's own data. The lyrics query never refetches on mount, so these are reset rather
// than invalidated: the next player to mount fetches the new lyrics instead of showing cached ones.
const SONG_QUERIES = [
  QUERY_KEYS.GET_LYRICS_BY_SONG_ID,
  QUERY_KEYS.GET_KARAOKE_BY_ID,
  QUERY_KEYS.GET_SONG_INFO_BY_SONG_ID,
  QUERY_KEYS.GET_LYRICS_VERSIONS,
]
// Lists that may now include the song
const LIST_QUERIES = [
  QUERY_KEYS.SEARCH_VIDEOS,
  QUERY_KEYS.SEARCH_LIBRARY,
  QUERY_KEYS.GET_GALLERY_SONGS,
  QUERY_KEYS.GET_SONGS_WITH_LYRICS,
]

// Mounted once in the root layout, so the running generation follows the user from page to page
const GenerationHost = () => {
  const { job, expanded } = useGeneration()
  const view = usePresentation(job)
  const queryClient = useQueryClient()
  const onPlayer = useMatch('/v/:videoId') !== null
  const completed = job?.status.kind === 'complete'

  const videoId = job?.videoId
  useEffect(() => {
    if (completed && videoId !== undefined) {
      for (const key of SONG_QUERIES) {
        void queryClient.resetQueries({ queryKey: [key, videoId] })
      }
      for (const key of LIST_QUERIES) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    }
  }, [completed, job?.id, videoId, queryClient])

  const announcement =
    !job || !view
      ? ''
      : job.status.kind === 'failed'
        ? `Lyrics generation failed: ${job.status.message}`
        : view.revealed
          ? 'Lyrics ready'
          : STEPS[view.index].title

  return (
    <MotionConfig reducedMotion='user'>
      <AnimatePresence initial={false}>
        {job &&
          view &&
          (expanded ? (
            <GenerationPanel
              key='panel'
              job={job}
              view={view}
              raised={onPlayer}
            />
          ) : (
            <GenerationFab key='fab' job={job} view={view} raised={onPlayer} />
          ))}
      </AnimatePresence>
      <p className='sr-only' aria-live='polite'>
        {announcement}
      </p>
    </MotionConfig>
  )
}

export default GenerationHost
