import type { Job } from '@/lib/generation/store'

// YouTube's thumbnail is known from the id alone, so the song shows from the first frame
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
          play: { label: 'Play Now', to: song },
          title: 'Lyrics Updated',
          versions: true,
        }
      : {
          play: { label: 'Preview', to: `${song}?version=${outcome.version}` },
          title: 'New Lyrics Ready',
          versions: true,
        }
  }
  if (outcome.kind === 'finished') {
    return {
      play: { label: 'Play Now', to: song },
      title: job.mode === 'regenerate' ? 'Lyrics Updated' : 'Ready to Sing',
      versions: job.mode === 'regenerate',
    }
  }
  if (outcome.kind === 'unchanged' && job.mode === 'regenerate') {
    return {
      play: { label: 'Play Now', to: song },
      title: 'Already Up to Date',
      versions: false,
    }
  }
  return {
    play: { label: 'Start Singing', to: song },
    title: 'Ready to Sing',
    versions: false,
  }
}

// '' until the backend sends the song's details, when nothing named the song before
export const titleOf = (job: Job) => job.video?.title ?? job.title

// Where a job stands in line, or null once it is under way
export const queueLabelOf = (job: Job) => {
  if (job.status.kind === 'waiting') {
    return 'Waiting to Start'
  }
  if (job.status.kind === 'running' && job.ahead > 0) {
    return `Queued · ${job.ahead} ${job.ahead === 1 ? 'Song' : 'Songs'} Ahead`
  }
  return null
}
