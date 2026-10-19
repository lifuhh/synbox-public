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

// What a saved song changes: its lyrics, song info and timing, its versions, and the searches listing it
const SAVED_SONG_QUERIES = [
  QUERY_KEYS.GET_LYRICS_BY_SONG_ID,
  QUERY_KEYS.GET_LYRICS_VERSIONS,
  QUERY_KEYS.GET_SONG_INFO_BY_SONG_ID,
  QUERY_KEYS.GET_KARAOKE_BY_ID,
  QUERY_KEYS.SEARCH_VIDEOS,
  QUERY_KEYS.SEARCH_LIBRARY,
]

// Mounted once in the root layout, so the running generation follows the user from page to page
const GenerationHost = () => {
  const { job, expanded } = useGeneration()
  const view = usePresentation(job)
  const queryClient = useQueryClient()
  const onPlayer = useMatch('/v/:videoId') !== null
  const completed = job?.status.kind === 'complete'

  useEffect(() => {
    if (completed) {
      for (const key of SAVED_SONG_QUERIES) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    }
  }, [completed, job?.id, queryClient])

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
