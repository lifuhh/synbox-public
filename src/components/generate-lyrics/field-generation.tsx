import { CircleAlertIcon, LoaderCircleIcon, ArrowRightIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import {
  refusalOf,
  startFromButton,
} from '@/components/generation/start-generation'
import { openRequestMore } from '@/lib/account-prompts'
import { cn } from '@/utils/cn'

// A press on a link field's Generate Lyrics (Home's field, the Search page's pasted link), from the press to its
// answer. The check runs here, at the field (the backend's account check and the video's, store.ts ›
// requestGeneration), so a song that can't be made says why where its link was pasted, with no notice over it. A
// song that starts opens the progress panel on it (store.ts › startGeneration)
export type Submission =
  | { kind: 'idle' }
  | { kind: 'checking' }
  // `quiet`: nothing went wrong (today's songs are added), so it reads as a note, with Request More beside it
  | { kind: 'refused'; message: string; quiet: boolean }

const IDLE: Submission = { kind: 'idle' }
// The link fades out of the field (input.tsx › bare, data-clearing) before it empties
const CLEAR_MS = 160

// `onStarted` empties the field once its text faded (Home's; the Search page keeps its link)
export const useFieldGeneration = (onStarted?: () => void) => {
  const [submission, setSubmission] = useState<Submission>(IDLE)
  const [clearing, setClearing] = useState(false)
  // Taken synchronously on the press, so a second click or Enter before the state renders does nothing
  const pressed = useRef(false)

  const generate = async (videoId: string, title?: string) => {
    if (pressed.current) {
      return
    }
    pressed.current = true
    setSubmission({ kind: 'checking' })
    const outcome = await startFromButton(
      { mode: 'new', title, videoId },
      { announce: false, opening: 'always', quiet: true }
    )
    pressed.current = false
    if (outcome.kind === 'refused') {
      const { message, quiet } = refusalOf(outcome.refusal)
      setSubmission({ kind: 'refused', message, quiet })
      return
    }
    if (outcome.kind === 'busy' || outcome.kind === 'prompted') {
      setSubmission(IDLE)
      return
    }
    setClearing(true)
    setTimeout(() => {
      onStarted?.()
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

// The pill's label while the action is Generate Lyrics. Each label takes its own width: on a swap the two
// cross-fade in one cell while the cell's width eases from one label's width to the other's, so the pill resizes
// continuously instead of jumping. The width eases like the search dock's flight (search-dock.tsx › easeOut,
// quadratic: full speed off the mark, no tail). Under Reduce Motion only the fade runs. The wider label, fading,
// spills half the labels' difference past each side of the cell (up to 16px), within the button's padding
export const GenerateLabel = ({ checking }: { checking: boolean }) => {
  const box = useRef<HTMLSpanElement>(null)
  const idle = useRef<HTMLSpanElement>(null)
  const busy = useRef<HTMLSpanElement>(null)
  // The width the cell was last given; 0 until the pill is first laid out (it is hidden on phones)
  const fitted = useRef(0)

  useLayoutEffect(() => {
    const cell = box.current
    const label = (checking ? busy : idle).current
    if (cell === null || label === null) {
      return
    }
    // Eases only on a swap in a cell already laid out; a first layout or a font that changed the label jumps
    const fit = (swap: boolean) => {
      // The computed width ignores the pill's scale on press; 'auto' (NaN) while the pill is hidden
      const width = Number.parseFloat(getComputedStyle(label).width)
      if (!(width > 0) || width === fitted.current) {
        return
      }
      const ease = swap && fitted.current > 0
      fitted.current = width
      if (!ease) {
        cell.style.transition = 'none'
      }
      cell.style.width = `${width}px`
      if (!ease) {
        // Applies the width before the transition comes back, so it doesn't run
        cell.getBoundingClientRect()
        cell.style.transition = ''
      }
    }
    fit(true)
    const observer = new ResizeObserver(() => {
      fit(false)
    })
    observer.observe(label)
    return () => {
      observer.disconnect()
    }
  }, [checking])

  return (
    <span
      ref={box}
      className='grid grid-cols-1 justify-items-center motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.33,0.67,0.67,1)]'>
      {([false, true] as const).map((forChecking) => (
        <span
          key={String(forChecking)}
          ref={forChecking ? busy : idle}
          aria-hidden={forChecking !== checking}
          className={cn(
            'col-start-1 row-start-1 inline-flex w-max items-center gap-2 transition-opacity duration-150 ease-out',
            forChecking !== checking && 'opacity-0'
          )}>
          <span className='text-label'>
            {forChecking ? 'Checking…' : 'Generate Lyrics'}
          </span>
          {forChecking ? (
            <LoaderCircleIcon className='size-5 shrink-0 motion-safe:animate-spin' />
          ) : (
            <ArrowRightIcon className='size-5 shrink-0' />
          )}
        </span>
      ))}
    </span>
  )
}

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
  if (submission.kind === 'refused' && submission.quiet) {
    return (
      <p className='text-muted-foreground'>
        {submission.message}
        {' · '}
        <button
          type='button'
          onClick={openRequestMore}
          className={INLINE_ACTION}>
          Request More
        </button>
      </p>
    )
  }
  if (submission.kind === 'refused') {
    return (
      <p className='flex items-start gap-1.5 text-error-strong'>
        {/* On the first line's centre, as the message can wrap */}
        <CircleAlertIcon aria-hidden className='mt-px size-4 shrink-0' />
        <span>{submission.message}</span>
      </p>
    )
  }
  return null
}
