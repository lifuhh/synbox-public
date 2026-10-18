import type { Ref } from 'react'
import { useImperativeHandle, useMemo, useRef } from 'react'

import { fillProgress, tokenFillSpans } from '@/lib/karaoke'
import type { KaraokeDocLine } from '@/types'
import { cn } from '@/utils/cn'

import { RubyText } from './RubyText'

// The overlay's requestAnimationFrame loop drives the fill through this
// handle; React never re-renders the line while it plays
export interface KaraokeLineHandle {
  setTime: (time: number) => void
}

interface KaraokeLineProps {
  line: KaraokeDocLine
  className?: string
  ref?: Ref<KaraokeLineHandle>
}

export const KaraokeLine = ({ line, className, ref }: KaraokeLineProps) => {
  const fillSpans = useMemo(() => tokenFillSpans(line), [line])
  const tokenElements = useRef<(HTMLSpanElement | null)[]>([])
  const isLatinLine = line.tokens.every(
    (token) => token.is_latin || token.morae.length === 0
  )

  useImperativeHandle(ref, () => {
    const written: number[] = []
    return {
      setTime: (time: number) => {
        for (const [index, spans] of fillSpans.entries()) {
          const element = tokenElements.current[index]
          const progress = fillProgress(spans, time)
          if (element && written[index] !== progress) {
            written[index] = progress
            element.style.setProperty('--p', String(progress))
          }
        }
      },
    }
  }, [fillSpans])

  return (
    <p
      lang={isLatinLine ? undefined : 'ja'}
      className={cn(
        'lyric-text-line align-middle leading-normal text-balance',
        isLatinLine
          ? 'font_noto_sans_reg'
          : 'font_noto_sans_jp_black_900 lyric-karaoke-ja',
        className
      )}>
      <span className='lyric-karaoke-line'>
        {line.tokens.map((token, index) => (
          <span
            // Tokens are positional and never reorder within a line
            // oxlint-disable-next-line no-array-index-key
            key={index}
            ref={(element) => {
              tokenElements.current[index] = element
            }}
            className='lyric-karaoke-token'>
            {token.is_latin || token.ruby.length === 0 ? (
              token.surface
            ) : (
              <RubyText segments={token.ruby} />
            )}
          </span>
        ))}
      </span>
    </p>
  )
}
