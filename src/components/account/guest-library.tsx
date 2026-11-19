import { ChevronRightIcon, ListMusicIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { GoogleMark } from '@/components/shared/google-mark'
import { Button } from '@/components/ui/button'
import { signInWithGoogle } from '@/lib/auth'
import { usePlaylists } from '@/lib/listening/store'

import { BenefitList } from './sign-in-sheet'

// The Library tab for a guest: bookmarks and offline songs live with an account, so instead of empty lists it says
// what signing in brings, once, with one button. Playlists a guest made on this device (from a song's menu or the
// Playlists page) get a row back to them. Top-aligned with the same title as the Playlists and You tabs; on a phone
// on its side the benefits go two across so the button stays above the tab dock
const GuestLibrary = () => {
  const [pending, setPending] = useState(false)
  const playlists = usePlaylists().length
  return (
    <div className='mx-auto flex w-full max-w-md flex-col gap-6 pt-6 short:max-w-2xl short:gap-4 short:pt-4'>
      <div className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold tracking-tight text-foreground sm:text-3xl'>
          Your Library
        </h1>
        <p className='text-muted-foreground'>
          Sign in and your songs follow you
        </p>
      </div>
      {playlists > 0 && (
        <Link
          to='/playlists'
          className='-mx-3 flex min-h-12 items-center gap-3 rounded-xl px-3 transition-colors hover:bg-accent'>
          <span className='grid size-6 shrink-0 place-items-center text-muted-foreground'>
            <ListMusicIcon className='size-5' aria-hidden />
          </span>
          <span className='flex min-w-0 flex-1 items-baseline gap-2'>
            <span className='shrink-0 text-foreground'>Playlists</span>
            <span className='truncate text-sm text-muted-foreground'>
              {playlists} on this device
            </span>
          </span>
          <ChevronRightIcon
            className='size-5 shrink-0 text-muted-foreground'
            aria-hidden
          />
        </Link>
      )}
      <BenefitList className='short:flex-row short:flex-wrap short:gap-x-8' />
      <Button
        variant='solid'
        gap='md'
        className='short:self-start'
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
    </div>
  )
}

export default GuestLibrary
