import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, MotionConfig } from 'motion/react'
import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMatch } from 'react-router'

import { useMediaQuery } from '@/hooks/use-media-query'
import { markGuestSongUsed, useAccess } from '@/lib/auth'
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
]

// Renders into the top bar's dock when there is one; AnimatePresence still sees it as its own child
const Docked = ({
  into,
  children,
}: {
  into: HTMLElement | null
  children: ReactElement
}) => (into ? createPortal(children, into) : children)

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
  // On a phone the corner sits over the player's lyrics and controls and the lists' play buttons, so the
  // minimized job docks into the top bar instead (top-bar.tsx), one tap from its panel as before
  const touch = useMediaQuery('(pointer: coarse)')
  const dock = touch
    ? document.querySelector<HTMLElement>('[data-generation-dock]')
    : null
  const docked = dock !== null

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

  // Every job that finishes refreshes its song, whichever one the panel shows, and today's song count
  const refreshed = useRef(new Set<number>())
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
      if (done.status.karaoke) {
        queryClient.setQueryData(
          [QUERY_KEYS.GET_KARAOKE_BY_ID, done.videoId, null],
          done.status.karaoke
        )
      }
      for (const key of LIST_QUERIES) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    }
  }, [access.kind, jobs, queryClient])

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
              docked={docked}
              onOutsideActivity={stepAside}
            />
          ) : (
            <Docked key={docked ? 'dock' : 'fab'} into={dock}>
              <GenerationFab
                job={job}
                count={jobs.length}
                view={view}
                raised={onPlayer}
                docked={docked}
              />
            </Docked>
          ))}
      </AnimatePresence>
      <p className='sr-only' aria-live='polite'>
        {announcement}
      </p>
    </MotionConfig>
  )
}

export default GenerationHost
