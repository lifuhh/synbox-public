import { RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { anyActive, useGeneration } from '@/lib/generation/store'
import { applyUpdate, useUpdateReady } from '@/lib/pwa'
import { cn } from '@/utils/cn'

// Shown once a new version has downloaded. A tap swaps it in and reloads the page the viewer is on.
// Hidden while lyrics generate, since the reload would cut their progress off
const UpdateButton = () => {
  const ready = useUpdateReady()
  const generation = useGeneration()
  const [applying, setApplying] = useState(false)

  if (!ready || anyActive(generation)) {
    return null
  }
  return (
    <Button
      variant='outline'
      size='icon'
      aria-label='Update Synbox'
      title='Update Synbox'
      disabled={applying}
      onClick={() => {
        setApplying(true)
        void applyUpdate()
      }}
      className='relative border-primary/80 invisible-ring hover:border-white'>
      <RefreshCwIcon
        className={cn('size-5 shrink-0', applying && 'animate-spin')}
      />
      <span
        aria-hidden
        className='absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-background'
      />
    </Button>
  )
}

export default UpdateButton
