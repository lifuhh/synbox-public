import { CheckIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface MessageFields {
  subject: string
  message: string
  // The hidden field only bots fill in
  website: string
}

export const INVALID = 'Add a subject and a message'

// 16px on touch, so iOS doesn't zoom into it
const FIELD =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-foreground/80 sm:text-sm touch:text-base'
const LABEL = 'text-sm font-medium text-foreground'

// The form of Contact Me and Send Feedback: Subject, Message, what went wrong (when something did), then a row with
// anything the dialog adds (`extra`) and Send. `send` answers null once sent, or the line to show. A fresh form each
// mount
export const MessageForm = ({
  subjectMax,
  messageMax,
  subjectPlaceholder,
  messagePlaceholder,
  extra,
  sentLabel,
  send: deliver,
  onDone,
}: {
  subjectMax: number
  messageMax: number
  subjectPlaceholder: string
  messagePlaceholder?: string
  extra?: ReactNode
  sentLabel: string
  send: (fields: MessageFields) => Promise<string | null>
  onDone: () => void
}) => {
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
      setProblem(INVALID)
      return
    }
    setSending(true)
    const failed = await deliver({
      message: message.trim(),
      subject: subject.trim(),
      website,
    })
    setSending(false)
    if (failed === null) {
      setSent(true)
      return
    }
    setProblem(failed)
  }

  if (sent) {
    return (
      <div className='flex flex-col items-center gap-3 py-4 text-center'>
        <span className='grid size-10 place-items-center rounded-full bg-primary-subtle text-primary-text'>
          <CheckIcon className='size-5' aria-hidden />
        </span>
        <output className='font-medium'>{sentLabel}</output>
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
      <div className='flex flex-col gap-1.5'>
        <label htmlFor={`${id}-subject`} className={LABEL}>
          Subject
        </label>
        <Input
          id={`${id}-subject`}
          value={subject}
          maxLength={subjectMax}
          placeholder={subjectPlaceholder}
          autoComplete='off'
          onChange={(event) => {
            setSubject(event.target.value)
            setProblem(null)
          }}
        />
      </div>
      <div className='flex flex-col gap-1.5'>
        <label htmlFor={`${id}-message`} className={LABEL}>
          Message
        </label>
        <textarea
          id={`${id}-message`}
          value={message}
          maxLength={messageMax}
          rows={5}
          placeholder={messagePlaceholder}
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
      </div>
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
      <output id={`${id}-problem`} className='text-sm text-error empty:hidden'>
        {problem}
      </output>
      {/* What the dialog adds shares Send's row, top-aligned: a control in it as tall as Send stays on Send's centre line when a note beside it wraps under it */}
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>{extra}</div>
        <Button
          type='submit'
          disabled={sending}
          className='shrink-0 touch:h-11'>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  )
}
