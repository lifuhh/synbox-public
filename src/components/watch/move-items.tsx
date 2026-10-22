import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

// Move Up and Move Down in a sortable row's menu: the way to reorder without dragging
export const MoveItems = ({
  index,
  count,
  moveTo,
}: {
  index: number
  count: number
  moveTo: (to: number) => void
}) => (
  <>
    <DropdownMenuItem
      disabled={index === 0}
      onSelect={() => {
        moveTo(index - 1)
      }}>
      <ArrowUpIcon className='mr-2 size-5 shrink-0' />
      Move Up
    </DropdownMenuItem>
    <DropdownMenuItem
      disabled={index === count - 1}
      onSelect={() => {
        moveTo(index + 1)
      }}>
      <ArrowDownIcon className='mr-2 size-5 shrink-0' />
      Move Down
    </DropdownMenuItem>
  </>
)
