import { CircleAlertIcon, LoaderCircleIcon, SparklesIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { startFromButton } from '@/components/generation/start-generation'
import { SIGN_IN_CODES, signInWithGoogle } from '@/lib/auth'
import { cn } from '@/utils/cn'

// A press on Home's Generate Lyrics, from the press to its answer. The check runs here, at the field (the backend's
// account check and the video's, store.ts › requestGeneration), so a song that can't be made says why where its
// link was pasted. A song that starts empties the field, and the progress panel opens on it (store.ts ›
// startGeneration)
export type Submission =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'refused'; message: string; signIn: boolean }

const IDLE: Submission = { kind: 'idle' }
// The link fades out of the field (input.tsx › bare, data-clearing) before it empties
const CLEAR_MS = 160

// `onStarted` empties the field once its text faded
export const useFieldGeneration = (onStarted: () => void) => {
  const [submission, setSubmission] = useState<Submission>(IDLE)
  const [clearing, setClearing] = useState(false)
  // Taken synchronously on the press, so a second click or Enter before the state renders does nothing
  const pressed = useRef(false)

  const generate = async (videoId: string) => {
    if (pressed.current) {
      return
    }
    pressed.current = true
    setSubmission({ kind: 'checking' })
    const outcome = await startFromButton(
      { mode: 'new', videoId },
      { announce: false, opening: 'always', quiet: true }
    )
    pressed.current = false
    if (outcome.kind === 'refused') {
      setSubmission({
        kind: 'refused',
        message: outcome.refusal.message,
        signIn: SIGN_IN_CODES.has(outcome.refusal.code),
      })
      return
    }
    if (outcome.kind === 'busy') {
      setSubmission(IDLE)
      return
    }
    setClearing(true)
    setTimeout(() => {
      onStarted()
      setClearing(false)
      setSubmission(IDLE)
    }, CLEAR_MS)
  }

  // Typing again puts away the last answer
  const edited = () => {
    if (submission.kind === 'refused') {
      setSubmission(IDLE)
    }
  }

  return {
    busy: () => pressed.current,
    checking: submission.kind === 'checking',
    clearing,
    edited,
    generate,
    refused: submission.kind === 'refused',
    submission,
  }
}

// The pill's label while the action is Generate Lyrics: both labels share one cell, so the pill keeps its width
// as they swap
export const GenerateLabel = ({ checking }: { checking: boolean }) => (
  <span className='grid justify-items-center'>
    {([false, true] as const).map((forChecking) => (
      <span
        key={String(forChecking)}
        aria-hidden={forChecking !== checking}
        className={cn(
          'col-start-1 row-start-1 inline-flex items-center gap-2',
          forChecking !== checking && 'invisible'
        )}>
        <span className='text-label'>
          {forChecking ? 'Checking…' : 'Generate Lyrics'}
        </span>
        {forChecking ? (
          <LoaderCircleIcon className='size-5 shrink-0 motion-safe:animate-spin' />
        ) : (
          <SparklesIcon className='size-5 shrink-0' />
        )}
      </span>
    ))}
  </span>
)

// A text button in the status line: its press area reaches 8px above and below the line, short of the field above
const INLINE_ACTION =
  "relative font-semibold text-foreground underline underline-offset-4 after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"

// The answer under the field, in its polite status line: what is being checked, why the song was refused (with
// Sign In when that is the way past it). Null otherwise
export const SubmissionStatus = ({
  submission,
}: {
  submission: Submission
}) => {
  if (submission.kind === 'checking') {
    return <p className='text-muted-foreground'>Checking the song…</p>
  }
  if (submission.kind === 'refused') {
    return (
      <p className='flex items-start gap-1.5 text-error-strong'>
        {/* On the first line's centre, as the message can wrap */}
        <CircleAlertIcon aria-hidden className='mt-px size-4 shrink-0' />
        <span>
          {submission.message}
          {submission.signIn && (
            <>
              {' '}
              <button
                type='button'
                onClick={() => {
                  void signInWithGoogle()
                }}
                className={INLINE_ACTION}>
                Sign In
              </button>
            </>
          )}
        </span>
      </p>
    )
  }
  return null
}
