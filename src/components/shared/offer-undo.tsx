import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'

// A change that drops what was there, with the app's short Undo toast (as removing a song from the queue): a style
// reset, an admin's Delete. Nothing to undo (null): no toast
export const offerUndo = (title: string, undo: (() => void) | null) => {
  if (undo === null) {
    return
  }
  toast({
    action: (
      <ToastAction altText={`Undo: ${title}`} onClick={undo}>
        Undo
      </ToastAction>
    ),
    duration: 5000,
    title,
  })
}
