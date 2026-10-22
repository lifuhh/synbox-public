import { LoaderCircleIcon } from 'lucide-react'

import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'
import { signInWithGoogle, SIGN_IN_CODES } from '@/lib/auth'
import type { GenerationRequest } from '@/lib/generation/store'
import { requestGeneration } from '@/lib/generation/store'

// A check answered this fast needs no notice; one that waits on a backend starting up (up to 20 s) does
const STARTING_NOTICE_DELAY_MS = 400

// Starts a generation from a button, or says at once why it can't start. Until the backend answers, a notice
// says the press was taken, unless the button shows that itself (`announce: false`)
export const startFromButton = async (
  request: GenerationRequest,
  { announce = true }: { announce?: boolean } = {}
) => {
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
  const refusal = await requestGeneration(request)
  clearTimeout(timer)
  if (refusal === null) {
    notice?.dismiss()
    return
  }
  const refused = {
    action: SIGN_IN_CODES.has(refusal.code) ? (
      <ToastAction
        altText='Sign In'
        onClick={() => {
          void signInWithGoogle()
        }}>
        Sign In
      </ToastAction>
    ) : undefined,
    description: refusal.message,
    // Long enough to read the reason, unlike the app's 2-second confirmations
    duration: 6000,
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
}
