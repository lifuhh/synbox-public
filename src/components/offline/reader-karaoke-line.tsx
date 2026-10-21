import type { Ref } from 'react'
import { useImperativeHandle, useMemo, useRef } from 'react'

import type { KaraokeLineHandle } from '@/components/lyrics-display/karaoke-line'
import { fillProgress, tokenFillParts } from '@/lib/karaoke'
import type { KaraokeDocLine } from '@/types'

// The player's karaoke line, drawn for a page instead of over a video: the reader's colours and font, no
// glow. The fill logic is the player's own (tokenFillParts, fillProgress). Unfilled, every part reads as
// sung, so only the line being played shows the wipe
export const ReaderKaraokeLine = ({
  line,
  className,
  ref,
}: {
  line: KaraokeDocLine
  className?: string
  ref?: Ref<KaraokeLineHandle>
}) => {
  const tokenParts = useMemo(() => tokenFillParts(line), [line])
  const parts = useMemo(() => tokenParts.flat(), [tokenParts])
  // Index of each token's first part in `parts`, for the element refs
  const firstPart = useMemo(
    () => tokenParts.map((_, i) => tokenParts.slice(0, i).flat().length),
    [tokenParts]
  )
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

  return (
    <p lang='ja' className={className}>
      {tokenParts.map((token, tokenIndex) => (
        // Tokens and parts are positional and never reorder within a line
        // oxlint-disable-next-line no-array-index-key
        <span key={tokenIndex}>
          {token.map((part, index) => {
            const at = firstPart[tokenIndex] + index
            return (
              <span
                // oxlint-disable-next-line no-array-index-key
                key={index}
                ref={(element) => {
                  partElements.current[at] = element
                }}
                className='reader-karaoke-part'>
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
    </p>
  )
}
