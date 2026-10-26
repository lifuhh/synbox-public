import { useState } from 'react'

import { GoogleMark } from '@/components/shared/google-mark'
import { Button } from '@/components/ui/button'
import { signInWithGoogle } from '@/lib/auth'

import { BenefitList } from './sign-in-sheet'

// The Library tab for a guest: bookmarks, playlists and offline songs live with an account, so instead of empty
// lists it says what signing in brings, once, with one button
const GuestLibrary = () => {
  const [pending, setPending] = useState(false)
  return (
    <div className='mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10'>
      <div className='flex flex-col gap-1'>
        <h1 className='text-2xl font-semibold tracking-tight text-foreground'>
          Your Library
        </h1>
        <p className='text-muted-foreground'>
          Sign in and your songs follow you
        </p>
      </div>
      <BenefitList />
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
    </div>
  )
}

export default GuestLibrary
