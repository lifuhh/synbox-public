import { CheckIcon } from 'lucide-react'
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
}

const FIELD =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-foreground/80 focus-visible:outline-hidden sm:text-sm touch:text-base'

// Contact Us: a subject, a message and, if they want an answer, where to send it (a signed-in account's own
// address to start with). Kept and emailed to the owner by the Worker; a guest can send too
const ContactForm = ({ onDone }: { onDone: () => void }) => {
  const { data: me } = useMe()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [replyTo, setReplyTo] = useState(me?.user?.email ?? '')
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
      replyTo: replyTo.trim(),
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
      <label htmlFor={`${id}-reply`} className='sr-only'>
        Your Email (Optional)
      </label>
      <Input
        id={`${id}-reply`}
        type='email'
        value={replyTo}
        maxLength={254}
        placeholder='Your email, for a reply (optional)'
        autoComplete='email'
        onChange={(event) => {
          setReplyTo(event.target.value)
          setProblem(null)
        }}
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

export const ContactDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className='max-w-md'>
      <DialogHeader>
        <DialogTitle>Contact Us</DialogTitle>
        <DialogDescription>
          Or email{' '}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className='underline underline-offset-2 hover:text-foreground'>
            {CONTACT_EMAIL}
          </a>
        </DialogDescription>
      </DialogHeader>
      {/* A fresh form each opening: a sent message doesn't come back as the next one */}
      {open && (
        <ContactForm
          onDone={() => {
            onOpenChange(false)
          }}
        />
      )}
    </DialogContent>
  </Dialog>
)

export default ContactDialog
