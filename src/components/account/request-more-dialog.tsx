import { useQueryClient } from '@tanstack/react-query'
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
import { sendSongRequest } from '@/lib/auth'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

// The Worker's limit (worker/src/requests.ts › REQUEST_NOTE_MAX)
const NOTE_MAX = 600

const FIELD =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-foreground/80 sm:text-sm touch:text-base'

// Request More: one short note about the listener, sent to the owner, who picks the number on /admin
const RequestForm = ({ onDone }: { onDone: () => void }) => {
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const id = useId()

  const send = async () => {
    if (sending) {
      return
    }
    if (note.trim().length < 2) {
      setProblem('Add a few words')
      return
    }
    setSending(true)
    try {
      // A request already waiting counts as sent: the owner will see that one
      await sendSongRequest(note.trim())
      setSent(true)
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GET_ME] })
    } catch {
      setProblem('Couldn’t send. Try again')
    }
    setSending(false)
  }

  if (sent) {
    return (
      <div className='flex flex-col items-center gap-3 py-4 text-center'>
        <span className='grid size-10 place-items-center rounded-full bg-primary-subtle text-primary-text'>
          <CheckIcon className='size-5' aria-hidden />
        </span>
        <output className='font-medium'>Thanks, I’ll get back to you</output>
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
      <label htmlFor={`${id}-note`} className='sr-only'>
        About You
      </label>
      <textarea
        id={`${id}-note`}
        value={note}
        maxLength={NOTE_MAX}
        rows={4}
        placeholder='I learn a few songs a week for karaoke nights with friends'
        aria-invalid={problem !== null || undefined}
        aria-describedby={`${id}-problem`}
        onChange={(event) => {
          setNote(event.target.value)
          setProblem(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void send()
          }
        }}
        className={`min-h-28 resize-y ${FIELD}`}
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

export const RequestMoreDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className='max-w-md'>
      <DialogHeader>
        <DialogTitle>Add More Songs a Day</DialogTitle>
        <DialogDescription>
          Tell me a bit about yourself and how you use Synbox
        </DialogDescription>
      </DialogHeader>
      {open && (
        <RequestForm
          onDone={() => {
            onOpenChange(false)
          }}
        />
      )}
    </DialogContent>
  </Dialog>
)
