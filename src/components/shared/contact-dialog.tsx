import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'

import { INVALID, MessageForm } from '@/components/shared/message-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useMe } from '@/lib/auth'
import { MESSAGE_MAX, sendContact, SUBJECT_MAX } from '@/lib/contact'
import type { ContactResult } from '@/lib/contact'

// The address shown beside the form, for anyone who'd rather write from their own mail
export const CONTACT_EMAIL = 'me@edwardhuang.dev'

const PROBLEMS: Record<Exclude<ContactResult, 'sent'>, string> = {
  failed: 'Couldn’t send, try again',
  invalid: INVALID,
  limit: `Daily limit reached, email ${CONTACT_EMAIL}`,
  signed_out: 'Signed out, sign in again',
}
// How long Copy reads Copied
const COPIED_MS = 2000

// A guest is shown where to write instead of a form: the owner's address, to open in their mail app or copy
const GuestContact = () => {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, COPIED_MS)
    } catch {
      // No clipboard (an old browser, or permission denied): the address is on screen to select
    }
  }
  return (
    <div className='flex items-center gap-2 rounded-md border border-input bg-background py-1 pr-1 pl-3'>
      <a
        href={`mailto:${CONTACT_EMAIL}`}
        className='min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline'>
        {CONTACT_EMAIL}
      </a>
      <Button
        type='button'
        variant='ghost'
        gap='md'
        onClick={() => {
          void copy()
        }}>
        {copied ? (
          <CheckIcon className='size-4' aria-hidden />
        ) : (
          <CopyIcon className='size-4' aria-hidden />
        )}
        <span aria-live='polite'>{copied ? 'Copied' : 'Copy'}</span>
      </Button>
    </div>
  )
}

// Contact Me: talking to the owner, answered by email. A signed-in account gets the form, which the Worker keeps and
// emails on, answered at the account's own email (named in the description, not editable); a guest gets the owner's
// address. Send Feedback (feedback-dialog.tsx) is the app's other way in, for bugs and ideas, answered in the app.
// Nothing until the session is known, so a signed-in account never sees the guest's version first
export const ContactDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const { data: me, isPending } = useMe()
  const email = me?.user?.email ?? null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Contact Me</DialogTitle>
          {!isPending && (
            <DialogDescription className='wrap-break-word'>
              {email === null ? (
                'Email me'
              ) : (
                <>
                  I’ll reply to{' '}
                  <span className='font-medium text-foreground'>{email}</span>
                </>
              )}
            </DialogDescription>
          )}
        </DialogHeader>
        {/* A fresh form each opening: a sent message doesn't come back as the next one */}
        {open && !isPending && email !== null && (
          <MessageForm
            subjectMax={SUBJECT_MAX}
            messageMax={MESSAGE_MAX}
            subjectPlaceholder='Question or collaboration'
            sentLabel='Message Sent'
            send={async (fields) => {
              const result = await sendContact(fields)
              return result === 'sent' ? null : PROBLEMS[result]
            }}
            onDone={() => {
              onOpenChange(false)
            }}
          />
        )}
        {!isPending && email === null && <GuestContact />}
      </DialogContent>
    </Dialog>
  )
}

export default ContactDialog
