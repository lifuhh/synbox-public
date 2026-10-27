import { CheckIcon } from 'lucide-react'
import { useId, useState } from 'react'

import { INVALID, MessageForm } from '@/components/shared/message-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useMe } from '@/lib/auth'
import { MESSAGE_MAX, sendFeedback, SUBJECT_MAX } from '@/lib/feedback'
import type { FeedbackResult } from '@/lib/feedback'
import { cn } from '@/utils/cn'

const PROBLEMS: Record<Exclude<FeedbackResult, 'sent'>, string> = {
  failed: 'Couldn’t send, try again',
  invalid: INVALID,
  limit: 'Daily limit reached, try tomorrow',
  signed_out: 'Signed out, sign in again',
}

// Whether the sender hears back, beside the choice that decides it: an account is told in the app when the feedback
// is resolved, unless it sends anonymously; a guest's is always anonymous
const Anonymity = ({
  signedIn,
  anonymous,
  onChange,
}: {
  signedIn: boolean
  anonymous: boolean
  onChange: (anonymous: boolean) => void
}) => {
  const id = useId()
  if (!signedIn) {
    return (
      <p className='flex h-10 items-center text-sm text-muted-foreground touch:h-11'>
        Sign in for updates
      </p>
    )
  }
  return (
    <div className='flex flex-wrap items-center gap-x-3'>
      {/* The whole row is the checkbox, so its press target is the row, not a 16px box; the keyboard ring goes on
          the drawn box (data-focus-proxy, globals.css) */}
      <button
        type='button'
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native checkbox's target would be its 16px box alone
        role='checkbox'
        aria-checked={anonymous}
        aria-describedby={`${id}-note`}
        data-focus-proxy
        onClick={() => {
          onChange(!anonymous)
        }}
        className='flex h-10 items-center gap-2 text-sm font-medium text-foreground touch:h-11'>
        <span
          aria-hidden
          className={cn(
            'focus-target grid size-4 shrink-0 place-items-center rounded-sm border transition-colors',
            anonymous
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-foreground/60 bg-background'
          )}>
          {anonymous && <CheckIcon className='size-3' strokeWidth={3} />}
        </span>
        Send Anonymously
      </button>
      <span
        id={`${id}-note`}
        aria-live='polite'
        className='text-sm text-muted-foreground'>
        {anonymous ? 'No updates' : 'Notified when resolved'}
      </span>
    </div>
  )
}

const FeedbackForm = ({
  signedIn,
  onDone,
}: {
  signedIn: boolean
  onDone: () => void
}) => {
  const [anonymous, setAnonymous] = useState(false)
  return (
    <MessageForm
      subjectMax={SUBJECT_MAX}
      messageMax={MESSAGE_MAX}
      subjectPlaceholder='Bug or idea'
      messagePlaceholder='What happened, or what you’d change'
      extra={
        <Anonymity
          signedIn={signedIn}
          anonymous={anonymous}
          onChange={setAnonymous}
        />
      }
      sentLabel='Feedback Sent'
      send={async (fields) => {
        const result = await sendFeedback({
          ...fields,
          anonymous: !signedIn || anonymous,
        })
        return result === 'sent' ? null : PROBLEMS[result]
      }}
      onDone={onDone}
    />
  )
}

// Send Feedback: about the app (a bug, an idea, something confusing), answered in the app when it is resolved. Contact
// Me (contact-dialog.tsx) is for talking to the owner, answered by email. Open to guests; nothing until the session
// is known, so an account never sees the guest's version first
export const FeedbackDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const { data: me, isPending } = useMe()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
          <DialogDescription>Tell us what to fix or add</DialogDescription>
        </DialogHeader>
        {/* A fresh form each opening: sent feedback, or the last choice of Send Anonymously, doesn't come back */}
        {open && !isPending && (
          <FeedbackForm
            signedIn={(me?.user ?? null) !== null}
            onDone={() => {
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export default FeedbackDialog
