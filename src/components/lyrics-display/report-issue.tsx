import { useAtomValue } from 'jotai'
import { useId, useState } from 'react'
import { useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { currentVideoAtom, stageClockAtom } from '@/context/atoms'
import { useAccess } from '@/lib/auth'
import { REPORT_MESSAGE_MAX, sendReport } from '@/lib/reports'
import { formatClock } from '@/utils'

import { parsePreviewVersion } from './version-preview-banner'

// What the report is about, fixed when it opened: the song, where it was, which lyrics version showed
export interface ReportTarget {
  videoId: string
  title: string
  atSeconds: number | null
  version: number | null
}

// Report Issue: the listener says what is wrong; the song, its time and its lyrics version go with it
export const ReportIssue = ({
  target,
  onClose,
}: {
  target: ReportTarget | null
  onClose: () => void
}) => {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const fieldId = useId()
  const close = () => {
    setMessage('')
    setFailed(false)
    onClose()
  }
  const send = async () => {
    if (target === null || message.trim() === '' || sending) {
      return
    }
    setSending(true)
    const result = await sendReport({ ...target, message })
    setSending(false)
    if (result === 'failed') {
      setFailed(true)
      return
    }
    close()
    toast(
      result === 'sent'
        ? { title: 'Report Sent' }
        : { title: 'Too Many Reports Today', variant: 'destructive' }
    )
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Report Issue</DialogTitle>
          <DialogDescription>
            <span className='block truncate'>
              {target?.title}
              {typeof target?.atSeconds === 'number' &&
                ` · ${formatClock(target.atSeconds)}`}
            </span>
          </DialogDescription>
        </DialogHeader>
        <form
          className='flex flex-col gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}>
          <label htmlFor={fieldId} className='sr-only'>
            What&apos;s wrong
          </label>
          <textarea
            id={fieldId}
            value={message}
            maxLength={REPORT_MESSAGE_MAX}
            rows={4}
            placeholder='What’s wrong?'
            onChange={(event) => {
              setMessage(event.target.value)
              setFailed(false)
            }}
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter sends; Enter alone is a new line
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void send()
              }
            }}
            className='min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-foreground/80 focus-visible:outline-hidden sm:text-sm touch:text-base'
          />
          <div className='flex items-center justify-between gap-3'>
            <output className='text-sm text-error'>
              {failed && 'Couldn’t send. Try again.'}
            </output>
            <Button type='submit' disabled={message.trim() === '' || sending}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Opens Report Issue for the song on screen: what it is about, and the moment, are fixed at the press; the song
// plays on while the listener writes
export const useReportIssue = (videoId: string) => {
  const [target, setTarget] = useState<ReportTarget | null>(null)
  const clock = useAtomValue(stageClockAtom)
  const video = useAtomValue(currentVideoAtom)
  const { admin } = useAccess()
  const [searchParams] = useSearchParams()
  const open = () => {
    setTarget({
      atSeconds: clock?.getTime() ?? null,
      title: video?.title ?? '',
      // Only admins see another version than the song's current lyrics (player-page.tsx)
      version: admin ? parsePreviewVersion(searchParams.get('version')) : null,
      videoId,
    })
  }
  const dialog = (
    <ReportIssue
      target={target}
      onClose={() => {
        setTarget(null)
      }}
    />
  )
  return { dialog, open }
}
