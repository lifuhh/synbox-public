import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { signInWithGoogle, useAccess } from '@/lib/auth'
import { useGetLyricsBySongId } from '@/lib/react-query/queries-and-mutations'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import {
  REPORT_MESSAGE_MAX,
  fetchMyReport,
  liveVersionOf,
  sendReport,
} from '@/lib/reports'
import type { OpenReport, ReportResult } from '@/lib/reports'
import { formatClock } from '@/utils'

import { parsePreviewVersion } from './version-preview-banner'

// What the report is about, fixed when it opened: the song, where it was, which lyrics version showed
export interface ReportTarget {
  videoId: string
  title: string
  atSeconds: number | null
  version: number | null
}

// The form's line under the message, for a refusal the listener can fix there
const PROBLEMS: Partial<Record<ReportResult, string>> = {
  failed: 'Couldn’t send. Try again.',
  signedOut: 'Signed out. Sign in again.',
  uninformative: 'Say what’s wrong',
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
  const [problem, setProblem] = useState<string | null>(null)
  const fieldId = useId()
  const problemId = useId()
  const hintId = useId()
  // One open report per song: the account's own, when there is one, shows instead of the form
  const queryClient = useQueryClient()
  const videoId = target?.videoId ?? ''
  const mineKey = [QUERY_KEYS.GET_MY_REPORT, videoId]
  const { data: mine } = useQuery({
    enabled: target !== null,
    queryFn: async () => await fetchMyReport(videoId),
    queryKey: mineKey,
    staleTime: 0,
  })
  // While it closes it keeps showing what it showed last while open: the song, the form with what was typed or
  // the account's report. A new report starts empty
  const [lastOpen, setLastOpen] = useState({ mine, target })
  if (
    target !== null &&
    (target !== lastOpen.target || mine !== lastOpen.mine)
  ) {
    if (target !== lastOpen.target) {
      setMessage('')
      setProblem(null)
    }
    setLastOpen({ mine, target })
  }
  const view = target === null ? lastOpen : { mine, target }
  const send = async () => {
    if (target === null || sending) {
      return
    }
    // Checked on Send, so the button never sits greyed out with no reason given
    if (message.trim() === '') {
      setProblem(PROBLEMS.uninformative ?? null)
      return
    }
    setSending(true)
    const result = await sendReport({ ...target, message })
    setSending(false)
    if (result === 'alreadyReported') {
      await queryClient.invalidateQueries({ queryKey: mineKey })
      return
    }
    if (result === 'sent') {
      queryClient.setQueryData<OpenReport>(mineKey, {
        createdAt: Date.now(),
        message: message.trim(),
      })
    }
    const shown = PROBLEMS[result]
    if (shown !== undefined) {
      setProblem(shown)
      return
    }
    onClose()
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
          onClose()
        }
      }}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {view.mine ? 'Already Reported' : 'Report Issue'}
          </DialogTitle>
          <DialogDescription>
            <span className='block truncate'>
              {view.target?.title}
              {typeof view.target?.atSeconds === 'number' &&
                ` · ${formatClock(view.target.atSeconds)}`}
            </span>
          </DialogDescription>
        </DialogHeader>
        {view.mine ? (
          <div className='flex flex-col gap-3'>
            <p className='text-sm text-muted-foreground'>
              We&apos;ll let you know when it&apos;s fixed.
            </p>
            <p className='max-h-40 overflow-y-auto rounded-md bg-muted px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap'>
              {view.mine.message}
            </p>
            <div className='flex justify-end'>
              <Button type='button' onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className='flex flex-col gap-3'
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}>
            <label htmlFor={fieldId} className='sr-only'>
              What&apos;s Wrong
            </label>
            <textarea
              id={fieldId}
              value={message}
              maxLength={REPORT_MESSAGE_MAX}
              rows={4}
              placeholder='What’s wrong?'
              aria-invalid={problem !== null || undefined}
              aria-describedby={`${hintId} ${problemId}`}
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
              className='min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-foreground/80 sm:text-sm touch:text-base'
            />
            <p id={hintId} className='-mt-1 text-xs text-muted-foreground'>
              One report per song: list every issue
            </p>
            <div className='flex items-center justify-between gap-3'>
              <output id={problemId} className='text-sm text-error'>
                {problem}
              </output>
              <Button type='submit' disabled={sending}>
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Opens Report Issue for the song on screen: what it is about, and the moment, are fixed at the press; the song
// plays on while the listener writes. Reporting is for accounts: a guest's press signs in instead
export const useReportIssue = (videoId: string) => {
  const [target, setTarget] = useState<ReportTarget | null>(null)
  const clock = useAtomValue(stageClockAtom)
  const video = useAtomValue(currentVideoAtom)
  const access = useAccess()
  const [searchParams] = useSearchParams()
  // The row the lyrics on screen came from (the stage and the watch page read the same cached query)
  const { data: lyricsRow } = useGetLyricsBySongId(videoId)
  const guest = access.kind === 'guest'
  const open = () => {
    if (guest) {
      void signInWithGoogle()
      return
    }
    // Only admins see another version than the song's current lyrics (player-page.tsx)
    const preview = access.admin
      ? parsePreviewVersion(searchParams.get('version'))
      : null
    setTarget({
      atSeconds: clock?.getTime() ?? null,
      title: video?.title ?? '',
      version: preview ?? liveVersionOf(lyricsRow),
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
  return {
    dialog: guest ? null : dialog,
    label: guest ? 'Sign In to Report' : 'Report Issue',
    open,
  }
}
