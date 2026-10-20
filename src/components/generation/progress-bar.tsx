import { cn } from '@/utils/cn'

interface ProgressBarProps {
  fraction: number
  // Running now: stripes drift backwards along the fill, which makes a wait feel shorter
  // (Harrison et al., "Faster Progress Bars", CHI 2010)
  active?: boolean
  failed?: boolean
  className?: string
}

// The fill is clipped rather than scaled, so the stripes keep their shape as it grows
const ProgressBar = ({
  fraction,
  active = false,
  failed = false,
  className,
}: ProgressBarProps) => (
  <div
    className={cn(
      'relative overflow-hidden rounded-full bg-white/10',
      className
    )}>
    <div
      className={cn(
        'absolute inset-0 rounded-full transition-clip duration-450 ease-out',
        failed
          ? 'bg-error-border/80'
          : 'bg-linear-to-r from-brand-light via-brand-glow to-primary'
      )}
      style={{
        clipPath: `inset(0 ${(1 - Math.min(Math.max(fraction, 0), 1)) * 100}% 0 0 round 9999px)`,
      }}>
      {active && (
        <div className='absolute inset-0 bg-stripes motion-safe:animate-progress-stripes' />
      )}
    </div>
  </div>
)

export default ProgressBar
