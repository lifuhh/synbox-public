import { GripVerticalIcon } from 'lucide-react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

interface Drag {
  from: number
  to: number
  dy: number
  startY: number
  // Each row's top and height when the drag began, in list coordinates
  rows: { top: number; height: number }[]
}

// Where a row dragged `dy` from `from` lands: the slot whose middle it has passed
const targetIndex = (drag: Omit<Drag, 'to'>) => {
  const { from, dy, rows } = drag
  const moving = rows[from]
  const centre = moving.top + moving.height / 2 + dy
  let to = from
  for (const [index, row] of rows.entries()) {
    if (index < from && centre < row.top + row.height / 2) {
      to = Math.min(to, index)
    }
    if (index > from && centre > row.top + row.height / 2) {
      to = index
    }
  }
  return to
}

// How far a row moves to open the gap: the dragged row follows the pointer, the rows it passes step aside
const shift = (drag: Drag | null, index: number) => {
  if (drag === null) {
    return 0
  }
  if (index === drag.from) {
    return drag.dy
  }
  const gap = drag.rows[drag.from].height
  if (drag.from < index && index <= drag.to) {
    return -gap
  }
  if (drag.to <= index && index < drag.from) {
    return gap
  }
  return 0
}

// A list the listener reorders: drag a row by its grip (mouse or finger), or focus the grip and press the
// arrow keys. The order is saved once, on the drop
export const SortableList = <T,>({
  items,
  keyOf,
  labelOf,
  onMove,
  renderItem,
  className,
}: {
  items: T[]
  keyOf: (item: T) => string
  labelOf: (item: T) => string
  onMove: (from: number, to: number) => void
  // `moveTo` moves this row to an index and says so, for a menu's Move Up and Move Down
  renderItem: (
    item: T,
    grip: ReactNode,
    index: number,
    moveTo: (to: number) => void
  ) => ReactNode
  className?: string
}) => {
  const [drag, setDrag] = useState<Drag | null>(null)
  // Read out after every move, by drag, arrow key or menu
  const [announcement, setAnnouncement] = useState('')
  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length || to === from) {
      return
    }
    onMove(from, to)
    setAnnouncement(
      `Moved ${labelOf(items[from])} to ${to + 1} of ${items.length}`
    )
  }
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const listRef = useRef<HTMLUListElement>(null)
  // After a keyboard move the grip of the moved row keeps the focus
  const focusKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    const key = focusKey.current
    if (key === null) {
      return
    }
    focusKey.current = null
    rowRefs.current.get(key)?.querySelector<HTMLElement>('[data-grip]')?.focus()
  })

  const start = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    const list = listRef.current
    if (list === null || event.button !== 0) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const listTop = list.getBoundingClientRect().top
    const rows = items.map((item) => {
      const box = rowRefs.current.get(keyOf(item))?.getBoundingClientRect()
      return {
        height: box?.height ?? 0,
        top: (box?.top ?? 0) - listTop,
      }
    })
    setDrag({ dy: 0, from: index, rows, startY: event.clientY, to: index })
  }
  const moveTo = (event: PointerEvent<HTMLButtonElement>) => {
    setDrag((current) => {
      if (current === null) {
        return current
      }
      const dy = event.clientY - current.startY
      return { ...current, dy, to: targetIndex({ ...current, dy }) }
    })
  }
  const drop = () => {
    if (drag !== null) {
      moveItem(drag.from, drag.to)
    }
    setDrag(null)
  }
  const keyMove =
    (index: number, key: string) =>
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
      if (step === undefined) {
        return
      }
      event.preventDefault()
      const to = index + step
      if (to < 0 || to >= items.length) {
        return
      }
      moveItem(index, to)
      focusKey.current = key
    }

  return (
    <>
      <output className='sr-only'>{announcement}</output>
      <ul ref={listRef} className={cn('relative flex flex-col', className)}>
        {items.map((item, index) => {
          const key = keyOf(item)
          const vars: CssVars = { '--drag-y': `${shift(drag, index)}px` }
          const dragging = drag?.from === index
          const grip = (
            <button
              type='button'
              data-grip
              data-press-ok='a drag handle: the row follows from the press, and lands on release'
              aria-label={`Move ${labelOf(item)}`}
              aria-keyshortcuts='ArrowUp ArrowDown'
              onPointerDown={start(index)}
              onPointerMove={drag === null ? undefined : moveTo}
              onPointerUp={drop}
              onPointerCancel={() => {
                setDrag(null)
              }}
              onKeyDown={keyMove(index, key)}
              className='grid h-11 w-8 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing'>
              <GripVerticalIcon className='size-4' aria-hidden />
            </button>
          )
          return (
            <li
              key={key}
              ref={(element) => {
                if (element === null) {
                  rowRefs.current.delete(key)
                } else {
                  rowRefs.current.set(key, element)
                }
              }}
              style={vars}
              className={cn(
                'translate-y-(--drag-y) list-none',
                dragging
                  ? 'relative z-10 rounded-xl bg-popover shadow-lg'
                  : drag !== null &&
                      'motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out'
              )}>
              {renderItem(item, grip, index, (to) => {
                moveItem(index, to)
              })}
            </li>
          )
        })}
      </ul>
    </>
  )
}
