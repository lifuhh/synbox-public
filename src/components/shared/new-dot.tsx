import { cn } from '@/utils/cn'

// A small dot after a label: something behind it the listener hasn't seen yet. Read as "New" by a screen reader.
// The same colour as the bell's unread dot (generation-panel.tsx › UnreadDot)
export const NewDot = ({ className }: { className?: string }) => (
  <>
    <span
      aria-hidden
      className={cn('size-1.5 shrink-0 rounded-full bg-brand-light', className)}
    />
    <span className='sr-only'>, New</span>
  </>
)
