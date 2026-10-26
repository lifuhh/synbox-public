import { CheckIcon, CopyIcon } from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useMe } from '@/lib/auth'
import { MESSAGE_MAX, sendContact, SUBJECT_MAX } from '@/lib/contact'
import type { ContactResult } from '@/lib/contact'

// The address shown beside the form, for anyone who'd rather write from their own mail
export const CONTACT_EMAIL = 'me@edwardhuang.dev'

const PROBLEMS: Partial<Record<ContactResult, string>> = {
  failed: 'Couldn’t send. Try again.',
  invalid: 'Add a subject and a message.',
  limit: `Too many today. Email ${CONTACT_EMAIL}.`,
  signed_out: 'Signed out. Sign in again.',
}
// How long Copy reads Copied
const COPIED_MS = 2000

const FIELD =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-foreground/80 focus-visible:outline-hidden sm:text-sm touch:text-base'

// Contact Us for a signed-in account: a subject and a message, kept and emailed to the owner by the Worker, which
// answers at the account's own email (shown above the form, not editable)
const ContactForm = ({ onDone }: { onDone: () => void }) => {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const id = useId()

  const send = async () => {
    if (sending) {
      return
    }
    if (subject.trim() === '' || message.trim().length < 2) {
      setProblem(PROBLEMS.invalid ?? null)
      return
    }
    setSending(true)
    const result = await sendContact({
      message: message.trim(),
      subject: subject.trim(),
      website,
    })
    setSending(false)
    if (result === 'sent') {
      setSent(true)
      return
    }
    setProblem(PROBLEMS[result] ?? null)
  }

  if (sent) {
    return (
      <div className='flex flex-col items-center gap-3 py-4 text-center'>
        <span className='grid size-10 place-items-center rounded-full bg-primary-subtle text-primary-text'>
          <CheckIcon className='size-5' aria-hidden />
        </span>
        <output className='font-medium'>Message Sent</output>
        <Button type='button' onClick={onDone}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <form
      className='flex flex-col gap-3'
      aria-busy={sending || undefined}
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}>
      <label htmlFor={`${id}-subject`} className='sr-only'>
        Subject
      </label>
      <Input
        id={`${id}-subject`}
        value={subject}
        maxLength={SUBJECT_MAX}
        placeholder='Subject'
        autoComplete='off'
        onChange={(event) => {
          setSubject(event.target.value)
          setProblem(null)
        }}
      />
      <label htmlFor={`${id}-message`} className='sr-only'>
        Message
      </label>
      <textarea
        id={`${id}-message`}
        value={message}
        maxLength={MESSAGE_MAX}
        rows={5}
        placeholder='Message'
        aria-invalid={problem !== null || undefined}
        aria-describedby={`${id}-problem`}
        onChange={(event) => {
          setMessage(event.target.value)
          setProblem(null)
        }}
        onKeyDown={(event) => {
          // Cmd/Ctrl+Enter sends; Enter alone is a new line
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void send()
          }
        }}
        className={`min-h-32 resize-y ${FIELD}`}
      />
      {/* Only bots fill this in: off screen, out of the tab order and the accessibility tree */}
      <input
        type='text'
        name='website'
        value={website}
        tabIndex={-1}
        autoComplete='off'
        aria-hidden
        className='absolute -left-[9999px] size-px opacity-0'
        onChange={(event) => {
          setWebsite(event.target.value)
        }}
      />
      <div className='flex items-center justify-between gap-3'>
        <output id={`${id}-problem`} className='text-sm text-error'>
          {problem}
        </output>
        <Button type='submit' disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  )
}

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

// Contact Us: the form for a signed-in account, the owner's address for a guest. Nothing until the session is known,
// so a signed-in account never sees the guest's version first
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
          <DialogTitle>Contact Us</DialogTitle>
          {!isPending && (
            <DialogDescription>
              {email === null ? (
                'For questions or concerns, email'
              ) : (
                <>
                  Replies go to{' '}
                  <span className='font-medium text-foreground'>{email}</span>
                </>
              )}
            </DialogDescription>
          )}
        </DialogHeader>
        {/* A fresh form each opening: a sent message doesn't come back as the next one */}
        {open && !isPending && email !== null && (
          <ContactForm
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
