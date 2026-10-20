import type { Job } from '@/lib/generation/store'

// Both sit in the same corner. Minimizing tucks the panel into it while the button grows out of it, and
// expanding runs the other way; each scales from that corner, so nothing travels across the screen.
const ENTER = { duration: 0.22, ease: [0.16, 1, 0.3, 1] } as const
const EXIT = { duration: 0.14, ease: [0.4, 0, 1, 1] } as const

// On a touch screen the panel is a card in the middle of the screen, so it scales from its centre there
export const PANEL_MOTION = {
  animate: { opacity: 1, scale: 1, transition: ENTER },
  exit: { opacity: 0, scale: 0.8, transition: EXIT },
  initial: { opacity: 0, scale: 0.8 },
  style: { transformOrigin: 'var(--panel-origin, bottom right)' },
} as const

export const FAB_MOTION = {
  animate: { opacity: 1, scale: 1, transition: { ...ENTER, delay: 0.06 } },
  exit: { opacity: 0, scale: 0.6, transition: EXIT },
  initial: { opacity: 0, scale: 0.6 },
  style: { transformOrigin: 'bottom right' },
} as const

// YouTube's thumbnail is known from the id alone, so the song shows from the first frame
// Bottom-right, clear of the home indicator, and on the player just above its control bar
export const surfacePlacement = (aboveStageControls: boolean) =>
  aboveStageControls
    ? 'right-[max(1rem,var(--safe-right))] bottom-[calc(var(--stage-controls-h,5rem)+0.5rem)] sm:right-6'
    : 'right-[max(1rem,var(--safe-right))] bottom-[max(1rem,var(--safe-bottom))] sm:right-6 sm:bottom-6'

export const thumbnailOf = (job: Job) =>
  job.video !== null && job.video.thumbnail !== ''
    ? job.video.thumbnail
    : `https://i.ytimg.com/vi/${job.videoId}/mqdefault.jpg`

// A thumbnail that fails to load hides, leaving the gradient drawn behind it. For an unknown or removed
// video YouTube answers 200 with a grey 120 px placeholder instead of an error, so that hides too.
export const hideBrokenImage = (event: { currentTarget: HTMLImageElement }) => {
  event.currentTarget.style.visibility = 'hidden'
}

export const hidePlaceholderImage = (event: {
  currentTarget: HTMLImageElement
}) => {
  if (event.currentTarget.naturalWidth <= 120) {
    hideBrokenImage(event)
  }
}

interface Outcome {
  title: string
  detail: string
  play: { label: string; to: string }
  versions: boolean
}

// What a finished job says, in the listener's terms: version numbers are for the versions page. A
// regeneration whose lyrics come out the same saves nothing (the backend rejects an identical version)
export const outcomeOf = (job: Job): Outcome | null => {
  if (job.status.kind !== 'complete') {
    return null
  }
  const { outcome } = job.status
  const song = `/v/${job.videoId}`
  if (outcome.kind === 'version') {
    return outcome.active
      ? {
          detail:
            'Everyone now gets the new lyrics. The old ones are kept in case you want them back.',
          play: { label: 'Play Now', to: song },
          title: 'Lyrics Updated',
          versions: true,
        }
      : {
          detail: 'Have a listen before they replace the current lyrics.',
          play: { label: 'Preview', to: `${song}?version=${outcome.version}` },
          title: 'New Lyrics Ready',
          versions: true,
        }
  }
  if (outcome.kind === 'unchanged' && job.mode === 'regenerate') {
    return {
      detail: 'This run came out the same as the current lyrics.',
      play: { label: 'Play Now', to: song },
      title: 'Already Up to Date',
      versions: false,
    }
  }
  return {
    detail:
      outcome.kind === 'unchanged'
        ? 'This song already had lyrics.'
        : 'Synced, translated and ready to sing along.',
    play: { label: 'Start Singing', to: song },
    title: 'Ready to Sing',
    versions: false,
  }
}

export const titleOf = (job: Job) => job.video?.title ?? job.title
