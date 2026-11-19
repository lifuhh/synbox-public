import { BookmarkIcon, DownloadIcon, SparklesIcon } from 'lucide-react'
import { useState } from 'react'

import { GoogleMark } from '@/components/shared/google-mark'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SONGS_A_DAY, signInWithGoogle, useAccess } from '@/lib/auth'
import { cn } from '@/utils/cn'

// What an account adds, the same three lines wherever sign-in is offered
export const SIGN_IN_BENEFITS = [
  { icon: SparklesIcon, text: `${SONGS_A_DAY} new songs a day, on me` },
  { icon: BookmarkIcon, text: 'Your style and bookmarks, everywhere' },
  { icon: DownloadIcon, text: 'Your songs, offline' },
] as const

// One line each: a bare icon, no disc behind it, in the same 24px box as the You tab's row icons so the text
// starts on the rows' edge
export const BenefitList = ({ className }: { className?: string }) => (
  <ul className={cn('flex flex-col gap-3', className)}>
    {SIGN_IN_BENEFITS.map(({ icon: Icon, text }) => (
      <li key={text} className='flex items-center gap-3 text-foreground'>
        <span className='grid size-6 shrink-0 place-items-center text-muted-foreground'>
          <Icon className='size-4' aria-hidden />
        </span>
        <span className='truncate'>{text}</span>
      </li>
    ))}
  </ul>
)

// Shown only when Generate Lyrics needs an account: a guest whose one free song is spent, or a listener signed out since
// the page loaded. Browsing never asks for anything. One way in, and an easy Not Now
export const SignInSheet = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const [pending, setPending] = useState(false)
  const access = useAccess()
  const spent = access.kind === 'guest' && !access.newSong
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>
            {spent ? 'That’s Your Free Song' : 'Sign In to Add Songs'}
          </DialogTitle>
          <DialogDescription>
            {spent
              ? 'Sign in to keep adding songs'
              : 'Browsing stays free for everyone'}
          </DialogDescription>
        </DialogHeader>
        <BenefitList />
        <div className='flex flex-col gap-2 pt-2'>
          <Button
            variant='solid'
            gap='md'
            disabled={pending}
            onClick={() => {
              setPending(true)
              void (async () => {
                const result = await signInWithGoogle()
                if (result === null || result.error !== null) {
                  setPending(false)
                }
              })()
            }}>
            <GoogleMark />
            Continue With Google
          </Button>
          <Button
            variant='ghost'
            onClick={() => {
              onOpenChange(false)
            }}>
            Not Now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
