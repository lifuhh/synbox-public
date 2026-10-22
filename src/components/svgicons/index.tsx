import type { ComponentProps } from 'react'

// The logo cropped to its drawing (waveform and wordmark), with clear space under it so the wordmark is the image's
// vertical centre: centring the image centres the wordmark on the bar's buttons, and the whole mark fits inside
// the 56px bar; it sits 4px low, so its top clears the screen edge by 6px. At 254×128 it is sharp at 2.4x its
// largest size (52.8px tall). A WebP (15KB): the SVG it was drawn
// from carries eight embedded PNGs (270KB). Not preloaded: on a slow phone a preload delayed the first paint by
// ~80ms, and this small file arrives ~0.4s after the bar anyway
export const SynboxLogo: React.FC = () => (
  <img
    src='/synbox-logo-4213026f.webp'
    alt=''
    width={254}
    height={128}
    className='pointer-events-none h-[2.475rem] w-auto translate-y-1 min-[360px]:h-11 sm:h-[3.3rem]'
  />
)

// YouTube's play mark, in its own red and white, so a link to the video reads as YouTube at a glance
export const YouTubeIcon = ({ className, ...props }: ComponentProps<'svg'>) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='0 0 28 20'
    className={className}
    {...props}>
    <path
      className='fill-youtube'
      d='M27.4 3.1A3.5 3.5 0 0 0 24.9.6C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5C5.3 20 14 20 14 20s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5C28 14.7 28 10 28 10s0-4.7-.6-6.9z'
    />
    <path className='fill-white' d='M11.2 14.3 18.4 10l-7.2-4.3z' />
  </svg>
)

// YouTube's Theater toggle in Lucide's line style (24px, 2px stroke): a wide frame with chevrons pointing out to
// widen the video, and in once it is wide (`theater`) to go back
export const TheaterIcon = ({
  theater = false,
  className,
  ...props
}: ComponentProps<'svg'> & { theater?: boolean }) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
    {...props}>
    <rect x='2' y='5' width='20' height='14' rx='3' />
    {theater ? (
      <path d='m6.5 9.5 2.5 2.5-2.5 2.5m11-5L15 12l2.5 2.5' />
    ) : (
      <path d='M9 9.5 6.5 12 9 14.5m6-5 2.5 2.5-2.5 2.5' />
    )}
  </svg>
)
