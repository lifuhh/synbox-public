import { RotateCwIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'

// Data that failed to load says what failed and offers another try, rather than loading forever: the one error state
// for a load (DESIGN.md §8). `inline`: a row in the flow of a page (Search's results), where a centred block would
// float away from what failed
const LoadError = ({
  message,
  retrying = false,
  onRetry,
  inline = false,
  className,
}: {
  message: string
  retrying?: boolean
  onRetry: () => void
  inline?: boolean
  className?: string
}) => (
  <div
    role='alert'
    className={cn(
      inline
        ? 'flex flex-wrap items-center gap-x-3 gap-y-2'
        : 'flex flex-col items-center justify-center gap-3 p-6 text-center',
      className
    )}>
    <p className='text-sm text-muted-foreground'>{message}</p>
    <Button variant='outline' onClick={onRetry} disabled={retrying} gap='md'>
      <RotateCwIcon
        className={cn('size-4', retrying && 'motion-safe:animate-spin')}
        aria-hidden
      />
      {retrying ? 'Retrying' : 'Retry'}
    </Button>
  </div>
)

export default LoadError
