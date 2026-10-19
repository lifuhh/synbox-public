import type { Job } from '@/lib/generation/store'

// The panel and the button are one surface: motion morphs between them through the shared layout id
export const SURFACE_LAYOUT_ID = 'generation-surface'
export const SURFACE_SPRING = {
  damping: 30,
  stiffness: 340,
  type: 'spring',
} as const

// YouTube's thumbnail is known from the id alone, so the song shows from the first frame
// Bottom-right, except on the player, whose control bar keeps its buttons in the bottom 72 px
export const surfacePlacement = (aboveStageControls: boolean) =>
  aboveStageControls
    ? 'right-4 bottom-24 sm:right-6'
    : 'right-4 bottom-4 sm:right-6 sm:bottom-6'

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

// What a finished job says. A regeneration of a song whose saved lyrics come out the same is a no-op on
// the backend (the cached timing, existing translations, an identical version rejected), so it says so.
export const outcomeCopy = (job: Job) => {
  if (job.status.kind !== 'complete') {
    return null
  }
  const { outcome } = job.status
  if (outcome.kind === 'version') {
    return {
      detail:
        'The current lyrics stay until you make this version the default.',
      title: `Saved as Version ${outcome.version}`,
    }
  }
  if (outcome.kind === 'unchanged') {
    return job.mode === 'regenerate'
      ? {
          detail:
            'The result was identical to the current lyrics, so nothing new was saved.',
          title: 'No Changes',
        }
      : { detail: 'These lyrics were already saved.', title: 'Lyrics Ready' }
  }
  return {
    detail: 'Synced, translated and ready to sing along.',
    title: 'Lyrics Ready',
  }
}

export const titleOf = (job: Job) => job.video?.title ?? job.title
