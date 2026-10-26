import { XIcon } from 'lucide-react'
import type { RefObject } from 'react'

import { cn } from '@/utils/cn'

// The ✕ inside a search field that empties it: Home's field, the Search page's, the top bar's and the Library's.
// It acts on the click (a mouse's release, a finger's lift, Enter or Space), so a touch that turns into a scroll
// clears nothing. A mouse press doesn't take focus from the field (mousedown's default is stopped); the field is
// focused again after clearing, inside the click, so a phone's keyboard stays up. Drawn 28px; on touch its press area
// reaches 8px further on every side (44px) without growing the field. Absent while the field is empty or `off`
export const ClearFieldButton = ({
  field,
  value,
  off = false,
  onClear,
  className,
}: {
  field: RefObject<HTMLInputElement | null>
  value: string
  off?: boolean
  onClear: () => void
  className?: string
}) =>
  value === '' || off ? null : (
    <button
      type='button'
      aria-label='Clear Search'
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={() => {
        onClear()
        field.current?.focus()
      }}
      className={cn(
        'relative grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground touch:after:absolute touch:after:-inset-2',
        className
      )}>
      <XIcon aria-hidden className='size-4' />
    </button>
  )
