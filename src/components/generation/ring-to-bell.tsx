import { useEffect, useEffectEvent, useRef } from 'react'

import { cn } from '@/utils/cn'

import { BELL_BODY, BELL_CLAPPER, BADGE_CLASSES } from './progress-ring'

// The last song in progress finished: the ring closes, the same stroke bends into the bell, and a tick pops
// where the count goes, flashes, and turns into the count. One clock (ms from the start) drives all of it
const CLOSE = [0, 300] as const
const DIGITS_OUT = [0, 220] as const
const MORPH = [250, 750] as const
const CLAPPER = [650, 850] as const
const BADGE_IN = 750
const BADGE_POP_MS = 250
const FLASH = [1000, 1150] as const
const TO_NUMBER = [1150, 1400] as const

// The ring's circle and the bell's outline as the same number of points, both clockwise from the top, so one
// closed stroke can move from one to the other
const POINTS = 120
const CENTRE = 20
const RADIUS = 13
// The 24 px glyph sits in the middle of the 40 px button
const GLYPH_OFFSET = 8

type Point = readonly [number, number]

const circlePoints = (): Point[] =>
  Array.from({ length: POINTS }, (_, index) => {
    const angle = -Math.PI / 2 + (index / POINTS) * 2 * Math.PI
    return [
      CENTRE + RADIUS * Math.cos(angle),
      CENTRE + RADIUS * Math.sin(angle),
    ] as const
  })

const bellPoints = (path: SVGPathElement): Point[] => {
  const length = path.getTotalLength()
  let points: Point[] = Array.from({ length: POINTS }, (_, index) => {
    const at = path.getPointAtLength((index / POINTS) * length)
    return [at.x + GLYPH_OFFSET, at.y + GLYPH_OFFSET] as const
  })
  // Twice the signed area; with y pointing down, positive is clockwise on screen
  let area = 0
  for (const [index, [x, y]] of points.entries()) {
    const [nx, ny] = points[(index + 1) % POINTS]
    area += x * ny - nx * y
  }
  if (area < 0) {
    points = points.toReversed()
  }
  let top = 0
  for (const [index, [, y]] of points.entries()) {
    if (y < points[top][1]) {
      top = index
    }
  }
  return [...points.slice(top), ...points.slice(0, top)]
}

const polygon = (from: Point[], to: Point[], k: number) =>
  `M${from
    .map(([x, y], index) => {
      const [tx, ty] = to[index]
      return `${(x + (tx - x) * k).toFixed(2)} ${(y + (ty - y) * k).toFixed(2)}`
    })
    .join('L')}Z`

// The first frame, drawn before the clock starts: the ring as the progress ring left it
const CIRCLE = circlePoints()
const CIRCLE_D = polygon(CIRCLE, CIRCLE, 0)

const span = (now: number, [start, end]: readonly [number, number]) =>
  Math.min(1, Math.max(0, (now - start) / (end - start)))

const easeInOut = (t: number) => (1 - Math.cos(Math.PI * t)) / 2

const easeOut = (t: number) => 1 - (1 - t) ** 3

const cssColor = (token: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim()

interface Parts {
  probePath: SVGPathElement
  outlinePath: SVGPathElement
  arcPath: SVGPathElement
  clapperPath: SVGPathElement
  digitsSpan: HTMLSpanElement
  badgeSpan: HTMLSpanElement
  tickIcon: SVGSVGElement
  numberSpan: HTMLSpanElement
}

// Runs the whole sequence on the elements; returns the way to stop it
const play = (
  {
    probePath,
    outlinePath,
    arcPath,
    clapperPath,
    digitsSpan,
    badgeSpan,
    tickIcon,
    numberSpan,
  }: Parts,
  { from, done, count }: { from: number; done: boolean; count: number },
  finish: () => void
) => {
  const ring = CIRCLE
  const bell = bellPoints(probePath)
  const success = cssColor('--color-success')
  const brand = cssColor('--color-brand-light')
  const showsBadge = done || count > 0
  const badgeAt = done ? BADGE_IN : MORPH[1]
  const end = done ? TO_NUMBER[1] : badgeAt + BADGE_POP_MS
  const animations: Animation[] = []
  if (showsBadge) {
    animations.push(
      badgeSpan.animate(
        [
          { offset: 0, scale: '0' },
          { offset: 0.6, scale: '1.3' },
          { offset: 0.85, scale: '0.92' },
          { offset: 1, scale: '1' },
        ],
        {
          delay: badgeAt,
          duration: BADGE_POP_MS,
          easing: 'ease-out',
          fill: 'both',
        }
      )
    )
  }
  if (done) {
    animations.push(
      badgeSpan.animate(
        [
          { backgroundColor: success, boxShadow: `0 0 0 0 ${success}` },
          {
            backgroundColor: success,
            boxShadow: '0 0 0 6px transparent',
            filter: 'brightness(1.5)',
            offset: 0.5,
          },
          { backgroundColor: success, boxShadow: '0 0 0 6px transparent' },
        ],
        {
          delay: FLASH[0],
          duration: FLASH[1] - FLASH[0],
          fill: 'backwards',
        }
      ),
      // Green to the theme colour through the hue between them at full colour, not the grey a straight blend
      // passes through; with nothing to count, the tick goes
      badgeSpan.animate(
        count > 0
          ? [
              { backgroundColor: success },
              ...[75, 50, 25].map((share) => ({
                backgroundColor: `color-mix(in oklch, ${success} ${share}%, ${brand})`,
              })),
              { backgroundColor: brand },
            ]
          : [
              { backgroundColor: success, opacity: 1, scale: '1' },
              { backgroundColor: success, opacity: 0, scale: '0.4' },
            ],
        {
          delay: TO_NUMBER[0],
          duration: TO_NUMBER[1] - TO_NUMBER[0],
          easing: 'ease-in-out',
          // Not backwards: until it starts, the pop and the flash own the badge
          fill: 'forwards',
        }
      ),
      tickIcon.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.4)' },
        ],
        {
          delay: TO_NUMBER[0],
          duration: (TO_NUMBER[1] - TO_NUMBER[0]) / 2,
          easing: 'ease-in',
          fill: 'both',
        }
      ),
      numberSpan.animate(
        [
          { opacity: 0, transform: 'scale(0.4)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        {
          delay: TO_NUMBER[0] + (TO_NUMBER[1] - TO_NUMBER[0]) / 2,
          duration: (TO_NUMBER[1] - TO_NUMBER[0]) / 2,
          easing: 'ease-out',
          fill: 'both',
        }
      )
    )
  }

  const started = performance.now()
  let frame = 0
  const draw = (time: number) => {
    const now = time - started
    const k = easeInOut(span(now, MORPH))
    const shape = polygon(ring, bell, k)
    outlinePath.setAttribute('d', shape)
    // The track's faint white strengthens into the bell's own colour as it takes shape
    outlinePath.style.strokeOpacity = String(0.1 + 0.9 * k)
    arcPath.setAttribute('d', shape)
    if (done) {
      const closed = from + (1 - from) * easeOut(span(now, CLOSE))
      arcPath.style.strokeDashoffset = String(1 - closed)
      arcPath.style.opacity = String(1 - span(now, [MORPH[0] + 150, MORPH[1]]))
    } else {
      arcPath.style.strokeDashoffset = String(1 - from)
      arcPath.style.opacity = String(1 - span(now, CLOSE))
    }
    const out = span(now, DIGITS_OUT)
    digitsSpan.style.opacity = String(1 - out)
    digitsSpan.style.transform = `scale(${1 - 0.4 * out})`
    const drop = easeOut(span(now, CLAPPER))
    clapperPath.style.opacity = String(drop)
    clapperPath.style.transform = `translateY(${-2 * (1 - drop)}px)`
    if (now >= end) {
      finish()
      return
    }
    frame = requestAnimationFrame(draw)
  }
  frame = requestAnimationFrame(draw)
  return () => {
    cancelAnimationFrame(frame)
    for (const animation of animations) {
      animation.cancel()
    }
  }
}

interface RingToBellProps {
  // Where the ring stood when the last song left it, 0 to 1
  from: number
  // The last song finished well: the ring closes and a tick shows. Otherwise the ring's arc fades instead
  done: boolean
  // Finished songs not yet seen; the tick turns into this number, or goes when it is 0
  count: number
  onDone: () => void
}

export const RingToBell = ({ from, done, count, onDone }: RingToBellProps) => {
  const probe = useRef<SVGPathElement>(null)
  const outline = useRef<SVGPathElement>(null)
  const arc = useRef<SVGPathElement>(null)
  const clapper = useRef<SVGPathElement>(null)
  const digits = useRef<HTMLSpanElement>(null)
  const badge = useRef<HTMLSpanElement>(null)
  const tick = useRef<SVGSVGElement>(null)
  const number = useRef<HTMLSpanElement>(null)
  const finish = useEffectEvent(onDone)

  useEffect(() => {
    const probePath = probe.current
    const outlinePath = outline.current
    const arcPath = arc.current
    const clapperPath = clapper.current
    const digitsSpan = digits.current
    const badgeSpan = badge.current
    const tickIcon = tick.current
    const numberSpan = number.current
    return probePath &&
      outlinePath &&
      arcPath &&
      clapperPath &&
      digitsSpan &&
      badgeSpan &&
      tickIcon &&
      numberSpan
      ? play(
          {
            arcPath,
            badgeSpan,
            clapperPath,
            digitsSpan,
            numberSpan,
            outlinePath,
            probePath,
            tickIcon,
          },
          { count, done, from },
          finish
        )
      : undefined
  }, [count, done, from])

  return (
    <span className='relative grid size-10 place-items-center'>
      <svg viewBox='0 0 40 40' className='absolute inset-0' aria-hidden>
        <defs>
          {/* The progress ring's gradient as it shows on screen, where that ring is turned a quarter back */}
          <linearGradient id='ring-to-bell' x1='0' y1='1' x2='1' y2='0'>
            <stop offset='0%' stopColor='var(--color-brand-light)' />
            <stop offset='100%' stopColor='var(--color-brand-ring-stop)' />
          </linearGradient>
        </defs>
        <path
          ref={probe}
          d={BELL_BODY}
          transform={`translate(${GLYPH_OFFSET} ${GLYPH_OFFSET})`}
          fill='none'
          visibility='hidden'
        />
        <path
          ref={outline}
          d={CIRCLE_D}
          strokeOpacity={0.1}
          fill='none'
          stroke='currentColor'
          strokeWidth={2}
          strokeLinejoin='round'
        />
        <path
          ref={arc}
          d={CIRCLE_D}
          strokeDashoffset={1 - from}
          fill='none'
          stroke='url(#ring-to-bell)'
          strokeWidth={2}
          strokeLinecap='round'
          strokeLinejoin='round'
          pathLength={1}
          strokeDasharray='1 1'
        />
        {/* Its own group carries the offset: the drop's CSS transform would replace a transform attribute */}
        <g transform={`translate(${GLYPH_OFFSET} ${GLYPH_OFFSET})`}>
          <path
            ref={clapper}
            d={BELL_CLAPPER}
            fill='none'
            stroke='currentColor'
            strokeWidth={2}
            strokeLinecap='round'
            opacity={0}
          />
        </g>
      </svg>
      <span
        ref={digits}
        aria-hidden
        className='col-start-1 row-start-1 text-badge leading-none font-semibold text-white tabular-nums [text-box:trim-both_cap_alphabetic]'>
        {Math.floor(from * 100)}
      </span>
      <span
        ref={badge}
        aria-hidden
        className={cn(BADGE_CLASSES, 'grid scale-0 place-items-center')}>
        <svg
          ref={tick}
          viewBox='0 0 24 24'
          className={cn('col-start-1 row-start-1 size-2.5', !done && 'hidden')}
          fill='none'
          stroke='currentColor'
          strokeWidth={4}
          strokeLinecap='round'
          strokeLinejoin='round'>
          <path d='M20 6 9 17l-5-5' />
        </svg>
        <span
          ref={number}
          className={cn('col-start-1 row-start-1', done && 'opacity-0')}>
          {count > 9 ? '9+' : count}
        </span>
      </span>
    </span>
  )
}
