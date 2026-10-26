import { useId } from 'react'

import { cn } from '@/utils/cn'

// A hint on its label's line ("Two Lines · Landscape only"): quieter than the label, after a centred dot.
// The dot takes its label's size, raised a little so it centres on the capitals as well as the x-height
const INLINE_HINT = 'text-xs font-normal text-faint'
const InlineHintDot = () => (
  <span
    aria-hidden='true'
    className='relative -top-[0.075em] px-1.5 font-normal text-faint'>
    ·
  </span>
)

// A switch row in a style panel (Lyrics Style, Text Style): on and off, applied at once without closing it. A
// hint, when the label alone doesn't say it, sits on the label's line after a dot
export const StyleSwitch = ({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) => {
  const labelId = useId()
  const hintId = useId()
  return (
    <button
      type='button'
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a switch: on and off, applied at once
      role='switch'
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={hint === undefined ? undefined : hintId}
      disabled={disabled}
      onClick={() => {
        onChange(!checked)
      }}
      className='group -mx-2 flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-sm font-medium disabled:opacity-60 touch:min-h-11'>
      <span className='flex min-w-0 items-baseline'>
        <span id={labelId}>{label}</span>
        {hint !== undefined && (
          <>
            <InlineHintDot />
            <span id={hintId} className={INLINE_HINT}>
              {hint}
            </span>
          </>
        )}
      </span>
      <span
        aria-hidden='true'
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-secondary ring-1 ring-border'
        )}>
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
            checked && 'translate-x-4'
          )}
        />
      </span>
    </button>
  )
}
