import { SearchIcon } from 'lucide-react'
import { useRef } from 'react'

import { ClearFieldButton } from '@/components/ui/clear-field-button'
import { cn } from '@/utils/cn'

// A list's own search: a pill with the magnifier, what was typed and the ✕ that empties it. It only reports what is
// typed; the list does the filtering (the Library, the admin page's lists). The label is for screen readers, the
// placeholder names what it searches. 16px text, so iOS doesn't zoom into it
export const SearchField = ({
  label,
  placeholder,
  value,
  onChange,
  className,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  className?: string
}) => {
  const field = useRef<HTMLInputElement>(null)
  return (
    <label className={cn('relative block', className)}>
      <span className='sr-only'>{label}</span>
      <SearchIcon className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
      <input
        ref={field}
        type='search'
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        placeholder={placeholder}
        enterKeyHint='search'
        autoComplete='off'
        className='h-10 w-full rounded-full border border-border bg-card pr-10 pl-9 text-base text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none [&::-webkit-search-cancel-button]:hidden'
      />
      <ClearFieldButton
        field={field}
        value={value}
        onClear={() => {
          onChange('')
        }}
        className='absolute top-1/2 right-2 -translate-y-1/2'
      />
    </label>
  )
}
