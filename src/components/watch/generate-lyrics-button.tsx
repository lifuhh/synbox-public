import { LoaderCircleIcon, SparklesIcon } from 'lucide-react'

import { startFromButton } from '@/components/generation/start-generation'
import { Button } from '@/components/ui/button'
import { isActive, useGeneration } from '@/lib/generation/store'

// Whether a generation for this video is running in this browser
export const useGenerating = (videoId: string) =>
  useGeneration().jobs.some((job) => job.videoId === videoId && isActive(job))

export const startGenerating = (videoId: string, title: string | undefined) => {
  void startFromButton({ mode: 'new', title, videoId })
}

// Generate Lyrics for a video outside the library, through the app's one entry point (the backend's check refuses
// what isn't a Japanese song). While it runs the button says so; when it ends, the page holding it becomes the
// player, as the song's lyrics row now exists (presence.ts)
export const GenerateLyricsButton = ({
  videoId,
  title,
}: {
  videoId: string
  title: string | undefined
}) => {
  const generating = useGenerating(videoId)
  return (
    <Button
      disabled={generating}
      gap='md'
      onClick={() => {
        startGenerating(videoId, title)
      }}>
      {generating ? (
        <LoaderCircleIcon
          aria-hidden
          className='size-4 shrink-0 motion-safe:animate-spin'
        />
      ) : (
        <SparklesIcon aria-hidden className='size-4 shrink-0' />
      )}
      {generating ? 'Generating Lyrics' : 'Generate Lyrics'}
    </Button>
  )
}
