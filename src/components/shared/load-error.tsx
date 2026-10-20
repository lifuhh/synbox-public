import { RotateCwIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'

// A section whose data failed to load says so and offers another try, rather than loading forever
const LoadError = ({
  message,
  retrying,
  onRetry,
  className,
}: {
  message: string
  retrying: boolean
  onRetry: () => void
  className?: string
}) => (
  <div
    role='alert'
    className={cn(
      'flex flex-col items-center justify-center gap-3 p-6 text-center',
      className
    )}>
    <p className='text-sm text-muted-foreground'>{message}</p>
    <Button
      variant='outline'
      onClick={onRetry}
      disabled={retrying}
      className='gap-2'>
      <RotateCwIcon
        className={cn('size-4', retrying && 'animate-spin')}
        aria-hidden
      />
      {retrying ? 'Retrying' : 'Retry'}
    </Button>
  </div>
)

export default LoadError
