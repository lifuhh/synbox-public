import type { Ref } from 'react'
import { useImperativeHandle, useMemo, useRef } from 'react'

import { balanceWrap } from '@/lib/balance-wrap'
import { fillProgress, tokenFillParts } from '@/lib/karaoke'
import type { KaraokeDocLine } from '@/types'
import { cn } from '@/utils/cn'

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
  const tokenParts = useMemo(() => tokenFillParts(line), [line])
  const parts = useMemo(() => tokenParts.flat(), [tokenParts])
  // Index of each token's first part in `parts`, for the element refs
  const firstPart = useMemo(
    () => tokenParts.map((_, i) => tokenParts.slice(0, i).flat().length),
    [tokenParts]
  )
  const partElements = useRef<(HTMLSpanElement | null)[]>([])
  const isLatinLine = line.tokens.every(
    (token) => token.is_latin || token.morae.length === 0
  )

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

  return (
    <p
      key={line.text}
      data-bench='lyrics-line'
      ref={balanceWrap}
      lang={isLatinLine ? undefined : 'ja'}
      className={cn(
        'lyric-text-line mx-auto align-middle',
        // Japanese lines leave room above for furigana, so a wrapped line's
        // readings never run into the line before it
        isLatinLine
          ? 'font_noto_sans_reg leading-normal'
          : 'font_noto_sans_jp_black_900 leading-loose lyric-karaoke-ja',
        className
      )}>
      <span className='lyric-karaoke-line'>
        {tokenParts.map((token, tokenIndex) => (
          // Tokens and parts are positional and never reorder within a line
          // oxlint-disable-next-line no-array-index-key
          <span key={tokenIndex}>
            {token.map((part, index) => {
              const own = firstPart[tokenIndex] + index
              return (
                <span
                  // oxlint-disable-next-line no-array-index-key
                  key={index}
                  ref={(element) => {
                    partElements.current[own] = element
                  }}
                  className='lyric-karaoke-part'>
                  {/* The fill sits on plain spans: iOS Safari does not paint a
                      text-clipped background on an <rt>, which left the furigana
                      showing only where it overlapped its parent's box */}
                  {part.rt ? (
                    <ruby className='lyric-ruby'>
                      <span className='lyric-karaoke-fill'>{part.base}</span>
                      <rt className='lyric-ruby-text'>
                        <span className='lyric-karaoke-fill'>{part.rt}</span>
                      </rt>
                    </ruby>
                  ) : (
                    <span className='lyric-karaoke-fill'>{part.base}</span>
                  )}
                </span>
              )
            })}
          </span>
        ))}
      </span>
    </p>
  )
}
