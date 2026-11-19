import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { readFieldText } from '@/utils'

// Home's field and the Search page's are one field: the same words, width, border states and action. The top bar's
// search uses the same placeholder (topbar-search.tsx), so Home's field flying into the bar carries the text it
// lands with. Under 360px wide the full text runs past the field
export const songFieldPlaceholder = (roomy: boolean) =>
  roomy ? 'Search or Paste a YouTube Link' : 'Search or Paste a Link'

// The line under the field while it holds words to search
export const SONG_FIELD_HINT = 'Search by title, artist or mood'

// The column the field sits in on both pages; the Search page's results share it, so they end on the field's edge
export const SONG_FIELD_COLUMN = 'w-full md:mx-auto md:max-w-170'

// The border tells what was typed: nothing, words, a usable link, or a link that fails to parse (InputField state)
export type SongFieldState = 'empty' | 'search' | 'valid' | 'invalid'

export const songFieldState = (value: string): SongFieldState => {
  const { kind } = readFieldText(value)
  if (kind === 'empty' || kind === 'search') {
    return kind
  }
  return kind === 'bad' ? 'invalid' : 'valid'
}

// The field's action: a round icon on phones, where a label would squeeze the text, and a labelled pill from sm up,
// its icon trailing the label. `pill` replaces the pill's content (Generate Lyrics' own label). While `busy` it
// stays focusable (aria-disabled) and its press does nothing
export const SongFieldAction = ({
  label,
  icon,
  pill,
  disabled = false,
  busy = false,
}: {
  label: string
  icon: ReactNode
  pill?: ReactNode
  disabled?: boolean
  busy?: boolean
}) => (
  <>
    <Button
      type='submit'
      disabled={disabled}
      aria-disabled={busy || undefined}
      variant='hero'
      size='icon'
      aria-label={label}
      className='shrink-0 aria-disabled:cursor-progress sm:hidden'>
      {icon}
    </Button>
    <Button
      type='submit'
      disabled={disabled}
      aria-disabled={busy || undefined}
      variant='hero'
      size='inset'
      gap='sm'
      className='hidden shrink-0 aria-disabled:cursor-progress sm:inline-flex'>
      {pill ?? (
        <>
          <span className='text-label'>{label}</span>
          {icon}
        </>
      )}
    </Button>
  </>
)
