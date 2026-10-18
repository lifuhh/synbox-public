import { Fragment } from 'react'

import type { RubySegment } from '@/lib/furigana'

interface RubyTextProps {
  segments: RubySegment[]
}

// Shared by plain lines today and karaoke token spans later; furigana spacing
// comes from the lyric-ruby utilities in globals.css
export const RubyText = ({ segments }: RubyTextProps) =>
  segments.map((segment, index) =>
    segment.rt ? (
      // Segments are positional and never reorder within a line
      // oxlint-disable-next-line no-array-index-key
      <ruby className='lyric-ruby' key={index}>
        {segment.base}
        <rt className='lyric-ruby-text'>{segment.rt}</rt>
      </ruby>
    ) : (
      // oxlint-disable-next-line no-array-index-key
      <Fragment key={index}>{segment.base}</Fragment>
    )
  )
