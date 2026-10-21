import { cn } from '@/utils/cn'

// An on/off control: the thumb's side and the track's fill both show the state, not the colour alone
export const Switch = ({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
}) => (
  <button
    type='button'
    role='switch'
    aria-checked={checked}
    aria-label={label}
    onClick={() => {
      onCheckedChange(!checked)
    }}
    className='group grid h-11 w-12 shrink-0 place-items-center rounded-full focus-visible:outline-hidden'>
    <span
      className={cn(
        'flex h-6 w-10 items-center rounded-full p-0.5 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring',
        checked ? 'bg-primary' : 'bg-muted'
      )}>
      <span
        className={cn(
          'size-5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none',
          checked && 'translate-x-4'
        )}
      />
    </span>
  </button>
)
