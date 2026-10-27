import { LoaderCircleIcon } from 'lucide-react'

import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'
import {
  markGuestSongSpent,
  openRequestMore,
  openSignInSheet,
} from '@/lib/account-prompts'
import {
  knownGuest,
  knownQuota,
  SIGN_IN_CODES,
  songsDoneText,
} from '@/lib/auth'
import type { GenerationRequest, PanelOpening } from '@/lib/generation/store'
import { requestGeneration } from '@/lib/generation/store'
import { NEW_SONGS_PAUSED } from '@/lib/generation/stream'
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

// How a press ended: the generation started, the check refused it, the song was already being checked, or the
// sign-in sheet was shown instead (nothing for the caller to show)
export type StartOutcome =
  | { kind: 'started' }
  | { kind: 'refused'; refusal: Refusal }
  | { kind: 'busy' }
  | { kind: 'prompted' }

// The friendly words for a refusal the app knows better than the backend's generic line: an account that added
// today's songs hears what it did and when more come, with Request More beside it. `quiet`: nothing the listener
// did wrong, so it reads as a note, not an error (today's songs added, new songs paused for everyone)
export const refusalOf = (
  refusal: Refusal
): { message: string; action: 'request_more' | null; quiet: boolean } => {
  if (refusal.code === 'quota_exceeded') {
    const quota = knownQuota()
    return {
      action: 'request_more',
      message: quota === null ? 'More at midnight' : songsDoneText(quota),
      quiet: true,
    }
  }
  if (refusal.code === NEW_SONGS_PAUSED.code) {
    return { action: null, message: NEW_SONGS_PAUSED.message, quiet: true }
  }
  return { action: null, message: refusal.message, quiet: false }
}

// A refusal as a notice. Today's songs added is good news, not an error: what was done, when more come, and
// Request More beside it. New songs paused is no one's error either
const refusalToast = (refusal: Refusal) => {
  const friendly = refusalOf(refusal)
  if (refusal.code === NEW_SONGS_PAUSED.code) {
    return {
      action: undefined,
      description: friendly.message,
      icon: undefined,
      title: NEW_SONGS_PAUSED.title,
      variant: 'default' as const,
    }
  }
  if (!friendly.quiet) {
    return {
      action: undefined,
      description: friendly.message,
      icon: undefined,
      title: "Can't Generate This Song",
      variant: 'destructive' as const,
    }
  }
  const limit = knownQuota()?.limit ?? null
  return {
    action: (
      <ToastAction altText='Request More' onClick={openRequestMore}>
        Request More
      </ToastAction>
    ),
    description: 'More at midnight',
    icon: undefined,
    title:
      limit === null
        ? 'That’s Today’s Songs'
        : `That’s ${limit} ${limit === 1 ? 'Song' : 'Songs'} Today`,
    variant: 'default' as const,
  }
}

// Starts a generation from a button, or says at once why it can't start. Until the checks answer, a notice
// says the press was taken, unless the button shows that itself (`announce: false`). A refusal shows as a notice
// unless the caller shows it where it was pressed (`quiet: true`). `opening`: when the panel opens on the song
// (store.ts › opensPanel); a link field's start passes `'always'`
export const startFromButton = async (
  request: GenerationRequest,
  {
    announce = true,
    quiet = false,
    opening = 'first',
  }: { announce?: boolean; quiet?: boolean; opening?: PanelOpening } = {}
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
  const refusal = await requestGeneration(
    request,
    watch.stayed,
    opening
  ).finally(watch.stop)
  clearTimeout(timer)
  // Started, or a second press while the first is still being checked
  if (refusal === null || refusal === 'checking') {
    notice?.dismiss()
    // A guest's one free song is this one now
    if (refusal === null && knownGuest()) {
      markGuestSongSpent()
    }
    return refusal === null ? { kind: 'started' } : { kind: 'busy' }
  }
  // A guest who had their free song, or signed out since the page loaded: the sign-in sheet, never an error
  if (SIGN_IN_CODES.has(refusal.code)) {
    notice?.dismiss()
    if (refusal.code === 'guest_song_used') {
      markGuestSongSpent()
    }
    openSignInSheet()
    return { kind: 'prompted' }
  }
  if (quiet) {
    notice?.dismiss()
    return { kind: 'refused', refusal }
  }
  const refused = refusalToast(refusal)
  // The notice turns into the refusal in place, rather than closing and leaving a gap before it
  if (notice === undefined) {
    toast(refused)
  } else {
    notice.update({ ...refused, id: notice.id, open: true })
  }
  return { kind: 'refused', refusal }
}
