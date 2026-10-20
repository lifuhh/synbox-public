import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useMatch } from 'react-router'

import { STEPS } from '@/lib/generation/plan'
import type { Job } from '@/lib/generation/store'
import {
  focusedJob,
  setGenerationExpanded,
  useGeneration,
} from '@/lib/generation/store'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

import GenerationFab from './generation-fab'
import GenerationPanel from './generation-panel'
import type { PanelExit } from './surface'
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
// Lists that may now include the song
const LIST_QUERIES = [
  QUERY_KEYS.SEARCH_VIDEOS,
  QUERY_KEYS.SEARCH_LIBRARY,
  QUERY_KEYS.GET_GALLERY_SONGS,
  QUERY_KEYS.GET_SONGS_WITH_LYRICS,
]

const announcementOf = (job: Job | null, view: Presentation | null) => {
  if (!job || !view) {
    return ''
  }
  if (job.status.kind === 'failed') {
    return `Lyrics generation failed: ${job.status.message}`
  }
  return view.revealed ? 'Lyrics ready' : STEPS[view.index].title
}

// Mounted once in the root layout, so the generations follow the user from page to page
const GenerationHost = () => {
  const generation = useGeneration()
  const { jobs, expanded } = generation
  const job = focusedJob(generation)
  const view = usePresentation(job)
  const queryClient = useQueryClient()
  const onPlayer = useMatch('/v/:videoId') !== null

  // How the panel leaves next time. Set before collapsing, and back to quick each time it opens.
  const [panelExit, setPanelExit] = useState<PanelExit>('quick')
  const [wasExpanded, setWasExpanded] = useState(expanded)
  if (expanded !== wasExpanded) {
    setWasExpanded(expanded)
    if (expanded) {
      setPanelExit('quick')
    }
  }
  const stepAside = () => {
    setPanelExit('gentle')
    setGenerationExpanded(false)
  }

  // Every job that finishes refreshes its song, whichever one the panel shows
  const refreshed = useRef(new Set<number>())
  useEffect(() => {
    for (const done of jobs) {
      if (done.status.kind !== 'complete' || refreshed.current.has(done.id)) {
        continue
      }
      refreshed.current.add(done.id)
      for (const key of SONG_QUERIES) {
        void queryClient.resetQueries({ queryKey: [key, done.videoId] })
      }
      for (const key of LIST_QUERIES) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    }
  }, [jobs, queryClient])

  const announcement = announcementOf(job, view)

  return (
    <MotionConfig reducedMotion='user'>
      <AnimatePresence initial={false} custom={panelExit}>
        {job &&
          view &&
          (expanded ? (
            <GenerationPanel
              key='panel'
              job={job}
              jobs={jobs}
              view={view}
              raised={onPlayer}
              onOutsideActivity={stepAside}
            />
          ) : (
            <GenerationFab
              key='fab'
              job={job}
              count={jobs.length}
              view={view}
              raised={onPlayer}
            />
          ))}
      </AnimatePresence>
      <p className='sr-only' aria-live='polite'>
        {announcement}
      </p>
    </MotionConfig>
  )
}

export default GenerationHost
