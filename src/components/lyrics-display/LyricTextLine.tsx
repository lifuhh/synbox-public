import DOMPurify from 'dompurify'
import React, { useMemo } from 'react'

import { cn } from '@/utils/cn'

interface LyricsTextLineProps {
  htmlContent: string
  className?: string
  divStyle?: React.CSSProperties
  kanjiSpacing?: string
  lang?: string
  useBlur?: boolean
  isEnglish?: boolean
  tone?: 'primary' | 'secondary'
}

const LyricTextLine = ({
  htmlContent,
  className = '',
  divStyle,
  kanjiSpacing = '0.2em',
  lang,
  useBlur = false,
  isEnglish = false,
  tone = 'primary',
}: LyricsTextLineProps) => {
  const sanitizedHtmlContent = useMemo(
    () => ({ __html: DOMPurify.sanitize(htmlContent) }),
    [htmlContent]
  )

  const pStyle: React.CSSProperties = {
    ...(!isEnglish && lang === 'ja' ? { '--kanji-spacing': kanjiSpacing } : {}),
    ...(isEnglish
      ? {
          fontFamily: "'Noto Sans', sans-serif !important",
          fontWeight: 'normal',
        }
      : {}),
  }

  return (
    <div
      style={divStyle}
      className={cn(
        { 'lyric-text-line-wrapper': useBlur },
        className
          .split(' ')
          .filter(
            (cls) =>
              cls.startsWith('mb-') ||
              cls.startsWith('mt-') ||
              cls.startsWith('m-')
          )
          .join(' ')
      )}>
      <p
        className={cn(
          'lyric-text-line',
          { 'lyric-text-line--secondary': tone === 'secondary' },
          isEnglish ? 'font_noto_sans_reg' : 'font_noto_sans_jp_black_900',
          'text-2vw',
          'align-middle leading-normal text-balance',
          className
            .split(' ')
            .filter(
              (cls) =>
                cls.startsWith('!text-') ||
                cls.startsWith('text-') ||
                cls.includes('balance') ||
                cls.includes('middle') ||
                cls.includes('leading')
            )
            .join(' ')
        )}
        style={pStyle}
        dangerouslySetInnerHTML={sanitizedHtmlContent}
      />
    </div>
  )
}

export const MemoizedLyricTextLine = React.memo(LyricTextLine)
