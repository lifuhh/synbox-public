import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

// A 28 px ring in the same 40 px box as the top bar's icons, as light as their 24 px glyphs. The dot at the
// ring's tip is R from the centre; --ring-dot-x and --ring-dot-y place its 4 px box's corner, 2 px off
const BOX = 40
const STROKE = 2
const R = (28 - STROKE) / 2
const C = 2 * Math.PI * R
// Trims the line box to the digits' cap height, so they center on the ring rather than on the font's box
const CAP_CENTERED = '[text-box:trim-both_cap_alphabetic] leading-none'

// Lucide's bell, drawn here so the ring can bend into exactly this outline (ring-to-bell.tsx)
export const BELL_BODY =
  'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326'
export const BELL_CLAPPER = 'M10.268 21a2 2 0 0 0 3.464 0'

export const BellGlyph = ({ className }: { className?: string }) => (
  <svg
    viewBox='0 0 24 24'
    className={cn('size-6 shrink-0', className)}
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden>
    <path d={BELL_BODY} className='in-aria-expanded:fill-current' />
    <path d={BELL_CLAPPER} />
  </svg>
)

// A count at the top-right of a top-bar control, in the theme colour. The number carries the meaning, not the colour
export const BADGE_CLASSES =
  'absolute top-1 right-1 h-3.5 min-w-3.5 rounded-full bg-brand-light px-0.5 text-micro leading-none font-semibold text-generation-surface tabular-nums'

export const CountBadge = ({ count }: { count: number }) => (
  <span aria-hidden className={cn(BADGE_CLASSES, 'grid place-items-center')}>
    {count > 9 ? '9+' : count}
  </span>
)

// One ring that fills with a song's overall progress, a softly pulsing dot at its tip, and the number at the
// centre. `overall` is 0 to 1
export const ProgressRing = ({
  overall,
  count,
}: {
  overall: number
  // Songs in progress, on a badge when there is more than one
  count: number
}) => {
  const percent = Math.floor(overall * 100)
  // The ring is drawn from 12 o'clock, so the dot's turn starts there too
  const turnVars: CssVars = {
    '--ring-turn': `rotate(${overall * 360 - 90}deg)`,
  }
  return (
    <span className='relative grid size-10 place-items-center'>
      <svg
        viewBox={`0 0 ${BOX} ${BOX}`}
        className='absolute inset-0 -rotate-90'
        aria-hidden>
        <defs>
          <linearGradient id='progress-ring' x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0%' stopColor='var(--color-brand-light)' />
            <stop offset='100%' stopColor='var(--color-brand-ring-stop)' />
          </linearGradient>
        </defs>
        <circle
          cx={BOX / 2}
          cy={BOX / 2}
          r={R}
          fill='none'
          strokeWidth={STROKE}
          className='stroke-white/10'
        />
        <circle
          cx={BOX / 2}
          cy={BOX / 2}
          r={R}
          fill='none'
          strokeWidth={STROKE}
          strokeLinecap='round'
          stroke='url(#progress-ring)'
          strokeDasharray={C}
          strokeDashoffset={C * (1 - overall)}
          className='transition-dashoffset duration-450 ease-out'
        />
      </svg>
      {overall > 0.01 && overall < 1 && (
        // Turns with the same timing as the arc, so the dot stays on its tip. It sits outside the SVG so its turn
        // and pulse can run on the compositor: inside the SVG, the turn re-laid out the page on every frame
        <span
          aria-hidden
          className='absolute inset-0 transform-(--ring-turn) transition-transform duration-450 ease-out [--ring-dot-x:31px] [--ring-dot-y:18px]'
          style={turnVars}>
          <span className='absolute top-(--ring-dot-y) left-(--ring-dot-x) size-1 rounded-full bg-white motion-safe:animate-breathe' />
        </span>
      )}
      {count > 1 && <CountBadge count={count} />}
      <span
        aria-hidden
        className={cn(
          'col-start-1 row-start-1 text-badge font-semibold text-white tabular-nums',
          CAP_CENTERED
        )}>
        {percent}
      </span>
    </span>
  )
}
