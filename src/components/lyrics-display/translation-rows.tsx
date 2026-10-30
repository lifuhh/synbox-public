import { Fragment } from 'react'
import type { ReactElement } from 'react'

// A translation's parts: the backend puts a "\n" where it breaks best (a phrase boundary), for a line too long for
// one row
export const translationParts = (text: string) =>
  text
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')

// A translation that fits one row draws on one row, its "\n" a space. One that doesn't breaks at the "\n": each part
// is an inline block, so a row ends only between them, and a part too long for a row of its own wraps evenly inside
// it. CSS alone, so it follows every resize, rotation and size change with no measuring
export const TranslationRows = ({
  parts,
}: {
  parts: readonly (ReactElement | string)[]
}) =>
  parts.length < 2
    ? parts[0]
    : parts.map((part, index) => (
        // Parts are positional and never reorder
        // oxlint-disable-next-line no-array-index-key
        <Fragment key={index}>
          {index > 0 && ' '}
          <span className='inline-block text-balance'>{part}</span>
        </Fragment>
      ))
