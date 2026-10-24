import { LoaderCircleIcon, SparklesIcon, TicketIcon } from 'lucide-react'

import { startFromButton } from '@/components/generation/start-generation'
import {
  useCanRequestInvite,
  useOpenRequestInvite,
} from '@/components/invite/request-invite'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/lib/auth'
import { generationPhase, useGeneration } from '@/lib/generation/store'
import { cn } from '@/utils/cn'

// Where this video stands in this browser: being checked by the backend, generating, or neither
export const useGenerationPhase = (videoId: string) =>
  generationPhase(useGeneration(), videoId)

// Whether a generation for this video is being checked or running in this browser
export const useGenerating = (videoId: string) =>
  useGenerationPhase(videoId) !== null

// An account on the default limit that has used today's songs and can still ask for more: its Generate Lyrics is
// Request Invite instead
export const useRequestInsteadOfGenerating = () => {
  const access = useAccess()
  const canRequest = useCanRequestInvite()
  return access.kind === 'user' && !access.newSong && canRequest
}

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
  const requestInstead = useRequestInsteadOfGenerating()
  const openRequestInvite = useOpenRequestInvite()
  const current = phase ?? 'idle'
  if (requestInstead && phase === null) {
    return (
      <Button onClick={openRequestInvite}>
        <span className='inline-flex items-center gap-2'>
          <TicketIcon aria-hidden className='size-4 shrink-0' />
          Request Invite
        </span>
      </Button>
    )
  }
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
