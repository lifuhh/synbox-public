import { LoaderCircleIcon } from 'lucide-react'

import { GoogleMark } from '@/components/shared/google-mark'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'
import { signInWithGoogle, SIGN_IN_CODES } from '@/lib/auth'
import type { GenerationRequest } from '@/lib/generation/store'
import { requestGeneration } from '@/lib/generation/store'
import type { Refusal } from '@/lib/generation/stream'

// A check answered this fast needs no notice; one that waits on a backend starting up (up to 20 s) does
const STARTING_NOTICE_DELAY_MS = 400

// Input that means the listener carried on: a press, a scroll, a key. The press that started the song came before
const MOVING_ON = ['pointerdown', 'wheel', 'touchmove', 'keydown'] as const

// Watches from now on whether the listener is still where they pressed: same page, no input since
const watchStay = () => {
  const path = location.pathname
  let moved = false
  const mark = () => {
    moved = true
  }
  for (const type of MOVING_ON) {
    document.addEventListener(type, mark, { capture: true, passive: true })
  }
  return {
    stayed: () => !moved && location.pathname === path,
    stop: () => {
      for (const type of MOVING_ON) {
        document.removeEventListener(type, mark, { capture: true })
      }
    },
  }
}

// How a press ended: the generation started, the check refused it, or the song was already being checked
export type StartOutcome =
  | { kind: 'started' }
  | { kind: 'refused'; refusal: Refusal }
  | { kind: 'busy' }

// Starts a generation from a button, or says at once why it can't start. Until the checks answer, a notice
// says the press was taken, unless the button shows that itself (`announce: false`). A refusal shows as a notice
// unless the caller shows it where it was pressed (`quiet: true`)
export const startFromButton = async (
  request: GenerationRequest,
  {
    announce = true,
    quiet = false,
  }: { announce?: boolean; quiet?: boolean } = {}
): Promise<StartOutcome> => {
  let notice: ReturnType<typeof toast> | undefined
  const timer = announce
    ? setTimeout(() => {
        notice = toast({
          duration: Infinity,
          icon: (
            <LoaderCircleIcon
              aria-hidden
              className='size-5 shrink-0 animate-spin text-primary-text motion-reduce:animate-none'
            />
          ),
          // What is happening: the server is asked whether it can take the song
          title: 'Checking Song',
          variant: 'progress',
        })
      }, STARTING_NOTICE_DELAY_MS)
    : undefined
  const watch = watchStay()
  const refusal = await requestGeneration(request, watch.stayed).finally(
    watch.stop
  )
  clearTimeout(timer)
  // Started, or a second press while the first is still being checked
  if (refusal === null || refusal === 'checking') {
    notice?.dismiss()
    return refusal === null ? { kind: 'started' } : { kind: 'busy' }
  }
  if (quiet) {
    notice?.dismiss()
    return { kind: 'refused', refusal }
  }
  const refused = {
    action: SIGN_IN_CODES.has(refusal.code) ? (
      <ToastAction
        altText='Sign In'
        onClick={() => {
          void signInWithGoogle()
        }}>
        <GoogleMark className='mr-2 -ml-1' />
        Sign In
      </ToastAction>
    ) : undefined,
    description: refusal.message,
    icon: undefined,
    title: "Can't Generate This Song",
    variant: 'destructive' as const,
  }
  // The notice turns into the refusal in place, rather than closing and leaving a gap before it
  if (notice === undefined) {
    toast(refused)
  } else {
    notice.update({ ...refused, id: notice.id, open: true })
  }
  return { kind: 'refused', refusal }
}
