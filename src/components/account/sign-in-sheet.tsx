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
import { signInWithGoogle } from '@/lib/auth'

// What an account adds, the same three lines wherever sign-in is offered
export const SIGN_IN_BENEFITS = [
  { icon: SparklesIcon, text: '5 new songs a day, on me' },
  {
    icon: BookmarkIcon,
    text: 'Your lyric style and bookmarks on every device',
  },
  { icon: DownloadIcon, text: 'Your songs, ready offline' },
] as const

export const BenefitList = () => (
  <ul className='flex flex-col gap-3'>
    {SIGN_IN_BENEFITS.map(({ icon: Icon, text }) => (
      <li key={text} className='flex items-center gap-3 text-foreground'>
        <span className='grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground'>
          <Icon className='size-4' aria-hidden />
        </span>
        <span className='text-pretty'>{text}</span>
      </li>
    ))}
  </ul>
)

// Shown only when a guest presses Generate Lyrics: browsing never asks for anything. One way in, and an easy Not Now
export const SignInSheet = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const [pending, setPending] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Sign In to Add Songs</DialogTitle>
          <DialogDescription>
            Browsing stays free for everyone
          </DialogDescription>
        </DialogHeader>
        <BenefitList />
        <div className='flex flex-col gap-2 pt-2'>
          <Button
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
