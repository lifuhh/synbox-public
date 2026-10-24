import { PencilIcon } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'

import { AdminCornerMark } from '@/components/shared/admin-mark'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccess } from '@/lib/auth'

// Loaded on first open: only admins ever see it, so it stays out of every visitor's first page
const RecommendationsEditor = lazy(async () => {
  const module = await import('./recommendations-editor')
  return { default: module.RecommendationsEditor }
})

// Beside the home page's Recommendations title, for admins only: the list's editor in a dialog, so the carousel
// it changes stays in sight once it closes. The 36px button reaches past the title's 28px line (-my-1) rather
// than growing the row, so nothing moves when it appears once the account has loaded
export const EditRecommendations = () => {
  const { admin } = useAccess()
  const [open, setOpen] = useState(false)
  if (!admin) {
    return null
  }
  return (
    <>
      <Button
        variant='ghost'
        size='icon-round'
        aria-label='Edit Recommendations'
        title='Edit Recommendations'
        className='relative -my-1'
        onClick={() => {
          setOpen(true)
        }}>
        <PencilIcon className='size-4' />
        <AdminCornerMark />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Edit Recommendations</DialogTitle>
            <DialogDescription>
              Add songs from our library, drag them into order, then save. Each
              visitor sees the list shuffled.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <Suspense fallback={<Skeleton className='h-40 w-full' />}>
              <RecommendationsEditor />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
