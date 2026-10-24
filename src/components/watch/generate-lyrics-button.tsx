import { LoaderCircleIcon, SparklesIcon } from 'lucide-react'

import { startFromButton } from '@/components/generation/start-generation'
import { Button } from '@/components/ui/button'
import { generationPhase, useGeneration } from '@/lib/generation/store'
import { cn } from '@/utils/cn'

// Where this video stands in this browser: being checked by the backend, generating, or neither
export const useGenerationPhase = (videoId: string) =>
  generationPhase(useGeneration(), videoId)

// Whether a generation for this video is being checked or running in this browser
export const useGenerating = (videoId: string) =>
  useGenerationPhase(videoId) !== null

export const startGenerating = (videoId: string, title: string | undefined) => {
  void startFromButton({ mode: 'new', title, videoId })
}

export const GENERATE_LABELS = {
  checking: 'Checking Song',
  generating: 'Generating Lyrics',
  idle: 'Generate Lyrics',
} as const

// Generate Lyrics for a video outside the library, through the app's one entry point (the backend's check refuses
// what isn't a Japanese song). From the press it says what is happening and takes no more presses: Checking Song
// while the backend is asked, then Generating Lyrics. When it ends, the page holding it becomes the player, as the
// song's lyrics row now exists (presence.ts)
export const GenerateLyricsButton = ({
  videoId,
  title,
}: {
  videoId: string
  title: string | undefined
}) => {
  const phase = useGenerationPhase(videoId)
  const current = phase ?? 'idle'
  return (
    <Button
      disabled={phase !== null}
      aria-busy={phase !== null}
      onClick={() => {
        startGenerating(videoId, title)
      }}>
      {/* Every state's icon and label in one cell, only the current one visible and centred, so the button keeps
          the widest one's width */}
      <span className='grid justify-items-center'>
        {Object.entries(GENERATE_LABELS).map(([state, text]) => (
          <span
            key={state}
            className={cn(
              'col-start-1 row-start-1 inline-flex items-center gap-2',
              state !== current && 'invisible'
            )}>
            {state === 'idle' ? (
              <SparklesIcon aria-hidden className='size-4 shrink-0' />
            ) : (
              <LoaderCircleIcon
                aria-hidden
                className='size-4 shrink-0 motion-safe:animate-spin'
              />
            )}
            {text}
          </span>
        ))}
      </span>
    </Button>
  )
}
