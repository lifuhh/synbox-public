import { useQueryClient } from '@tanstack/react-query'
import { atom, useAtom, useSetAtom } from 'jotai'
import { TicketIcon } from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'
import { useAccess } from '@/lib/auth'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

// worker/src/invites.ts › INVITE_NOTE_MAX
const INVITE_NOTE_MAX = 500

// Request Invite is one dialog for the whole app (mounted in app.tsx), opened from the profile menu, the hints
// beside Generate and a refusal's toast
const requestInviteOpenAtom = atom(false)

// An account on the default limit that may still ask; null for a guest, an invited account or one that asked
const useInvitePrompt = () => {
  const access = useAccess()
  if (access.kind !== 'user' || access.invite.invited) {
    return null
  }
  return { limit: access.quota.limit ?? 0, requested: access.invite.requested }
}

const songsADay = (limit: number) =>
  `${limit} new song${limit === 1 ? '' : 's'} a day`

export const RequestInviteDialog = () => {
  const [open, setOpen] = useAtom(requestInviteOpenAtom)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const queryClient = useQueryClient()
  const prompt = useInvitePrompt()
  const fieldId = useId()
  const close = () => {
    setOpen(false)
    setNote('')
    setFailed(false)
  }
  const send = async () => {
    if (sending) {
      return
    }
    setSending(true)
    const sent = await fetch('/api/me/invite-request', {
      body: JSON.stringify({ note }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
      .then((response) => response.ok)
      .catch(() => false)
    setSending(false)
    if (!sent) {
      setFailed(true)
      return
    }
    close()
    toast({ title: 'Invite Requested' })
    await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.GET_ME] })
  }
  return (
    <Dialog
      open={open && prompt !== null && !prompt.requested}
      onOpenChange={(next) => {
        if (!next) {
          close()
        }
      }}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Request Invite</DialogTitle>
          <DialogDescription>
            More new songs a day for your account (now{' '}
            {songsADay(prompt?.limit ?? 1)})
          </DialogDescription>
        </DialogHeader>
        <form
          className='flex flex-col gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}>
          <label htmlFor={fieldId} className='sr-only'>
            Note
          </label>
          <textarea
            id={fieldId}
            value={note}
            maxLength={INVITE_NOTE_MAX}
            rows={3}
            placeholder='Note (optional)'
            onChange={(event) => {
              setNote(event.target.value)
              setFailed(false)
            }}
            className='min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-foreground/80 focus-visible:outline-hidden sm:text-sm touch:text-base'
          />
          <div className='flex items-center justify-between gap-3'>
            <output className='text-sm text-error'>
              {failed ? 'Couldn’t send. Try again.' : null}
            </output>
            <Button type='submit' disabled={sending}>
              {sending ? 'Sending…' : 'Send Request'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// An account on the default limit that hasn't asked yet: where it is out of songs, Generate becomes Request Invite
export const useCanRequestInvite = () => {
  const prompt = useInvitePrompt()
  return prompt !== null && !prompt.requested
}

export const useOpenRequestInvite = () => {
  const setOpen = useSetAtom(requestInviteOpenAtom)
  return () => {
    setOpen(true)
  }
}

// The profile menu's entry, while the account can still ask (once asked, the account line says so)
export const RequestInviteMenuItem = () => {
  const setOpen = useSetAtom(requestInviteOpenAtom)
  if (!useCanRequestInvite()) {
    return null
  }
  return (
    <DropdownMenuItem
      className='cursor-pointer'
      onSelect={() => {
        setOpen(true)
      }}>
      <TicketIcon className='mr-2 size-5 shrink-0' />
      <span>Request Invite</span>
    </DropdownMenuItem>
  )
}

// On the toast that says today's songs are used: Request Invite, when the account may still ask
export const RequestInviteToastAction = () => {
  const setOpen = useSetAtom(requestInviteOpenAtom)
  if (!useCanRequestInvite()) {
    return null
  }
  return (
    <ToastAction
      altText='Request Invite'
      onClick={() => {
        setOpen(true)
      }}>
      Request Invite
    </ToastAction>
  )
}
