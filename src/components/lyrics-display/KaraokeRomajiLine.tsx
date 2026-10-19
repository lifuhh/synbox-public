import type { Ref } from 'react'
import { useImperativeHandle, useMemo, useRef } from 'react'

import { fillProgress, romajiFillParts } from '@/lib/karaoke'
import type { KaraokeDocLine } from '@/types'
import { cn } from '@/utils/cn'

import type { KaraokeLineHandle } from './KaraokeLine'

interface KaraokeRomajiLineProps {
  line: KaraokeDocLine
  className?: string
  ref?: Ref<KaraokeLineHandle>
}

// The romaji under a karaoke line, filled word by word from the same morae, so
// readers who don't read Japanese can sing along too
export const KaraokeRomajiLine = ({
  line,
  className,
  ref,
}: KaraokeRomajiLineProps) => {
  const parts = useMemo(() => romajiFillParts(line), [line])
  const partElements = useRef<(HTMLSpanElement | null)[]>([])

  useImperativeHandle(ref, () => {
    const written: number[] = []
    return {
      setTime: (time: number) => {
        for (const [index, part] of parts.entries()) {
          const element = partElements.current[index]
          const progress = fillProgress(part.spans, time)
          if (element && written[index] !== progress) {
            written[index] = progress
            element.style.setProperty('--p', String(progress))
          }
        }
      },
    }
  }, [parts])

  // Same type as the plain romaji line (LyricTextLine, tone secondary); the
  // fill paints the secondary colour until each word is sung
  return (
    <p
      className={cn(
        'lyric-text-line align-middle font_noto_sans_jp_black_900 text-2vw leading-normal text-balance',
        className
      )}>
      <span className='lyric-karaoke-line'>
        {parts.map((part, index) => (
          // Words are positional and never reorder within a line
          // oxlint-disable-next-line no-array-index-key
          <span key={index}>
            {index > 0 && ' '}
            <span
              ref={(element) => {
                partElements.current[index] = element
              }}
              className='lyric-karaoke-part'>
              {part.base}
            </span>
          </span>
        ))}
      </span>
    </p>
  )
}
