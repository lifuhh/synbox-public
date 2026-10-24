import { SearchIcon, XIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { useGallerySongs } from '@/lib/react-query/queries-and-mutations'
import type { LibraryListSong } from '@/lib/synbox-flask/discovery'
import { matchTitles } from '@/lib/title-match'
import { cn } from '@/utils/cn'

const MAX_SONGS = 8

// What the dropdown lists while the field has text: the karaoke songs (the mic badge) whose title or channel holds
// every word, then the full search for the words. Mounted only while open, so a page that never searches never
// loads the list
const Results = ({
  query,
  active,
  listId,
  optionId,
  onPick,
  className,
  inset,
}: {
  query: string
  active: number
  listId: string
  optionId: (index: number) => string
  onPick: (target: string) => void
  className: string
  // Rows inset on the panel, their thumbnails under the field's search icon
  inset: boolean
}) => {
  const { songs } = useGallerySongs()
  const matches = matchTitles(
    songs.filter((song) => song.karaoke),
    query,
    MAX_SONGS
  )
  const rows: { target: string; song?: LibraryListSong }[] = [
    ...matches.map((song) => ({ song, target: `/v/${song.videoId}` })),
    { target: `/search?q=${encodeURIComponent(query.trim())}` },
  ]
  return (
    <ul
      id={listId}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- the combobox pattern's popup: a <select> or <datalist> can't hold thumbnails
      role='listbox'
      aria-label='Search Results'
      className={cn('overflow-y-auto overscroll-contain', className)}>
      {rows.map((row, index) => (
        <li
          key={row.target}
          id={optionId(index)}
          data-target={row.target}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- an option of the listbox above
          role='option'
          aria-selected={index === active}
          // Pointer down, not click: the field's blur would close the list before a click lands
          onPointerDown={(event) => {
            event.preventDefault()
            onPick(row.target)
          }}
          className={cn(
            'flex h-11 cursor-pointer items-center gap-3 px-3 text-sm text-foreground touch:h-12',
            inset && 'mx-2 rounded-xl px-3.5',
            index === active ? 'bg-accent' : 'hover:bg-accent'
          )}>
          {row.song ? (
            <>
              <img
                src={row.song.thumbnailUrl}
                alt=''
                loading='lazy'
                className='aspect-video h-8 shrink-0 rounded-sm bg-thumbnail-placeholder object-cover'
              />
              <span className='min-w-0 flex-1 truncate'>{row.song.title}</span>
            </>
          ) : (
            <>
              <span className='grid w-14 shrink-0 place-items-center text-muted-foreground'>
                <SearchIcon aria-hidden className='size-4' />
              </span>
              <span className='min-w-0 flex-1 truncate'>
                Search “{query.trim()}”
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

// What the screen shows above the keyboard, as --vv-top and --vv-h on `box`, while `on`. iOS keeps the layout
// viewport (and dvh) full height under its keyboard and only shrinks the visual viewport, so a list sized by the
// page would run under the keys
const followViewport = (vv: VisualViewport, el: HTMLElement) => {
  const update = () => {
    el.style.setProperty('--vv-top', `${vv.offsetTop}px`)
    el.style.setProperty('--vv-h', `${vv.height}px`)
  }
  update()
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  return () => {
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
  }
}

const useVisibleViewport = (
  box: RefObject<HTMLElement | null>,
  on: boolean
) => {
  useEffect(() => {
    const vv = globalThis.visualViewport
    const el = box.current
    return on && vv !== null && el !== null ? followViewport(vv, el) : undefined
  }, [box, on])
}

// A search field with an instant dropdown, as on YouTube. `inline` is the field in the bar on a wide screen;
// `button` is a phone's search button, which opens the same field on a panel floating under the status bar
export const TopbarSearch = ({ variant }: { variant: 'inline' | 'button' }) => {
  const navigate = useNavigate()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const [active, setActive] = useState(-1)
  const open = focused && query.trim() !== ''
  const optionId = (index: number) => `${listId}-${index}`
  const panel = variant === 'button'
  // The row the arrow keys reach scrolls into view: the list is a box of its own, shorter than its results on a
  // phone on its side, and focus stays in the field (aria-activedescendant), so nothing else would scroll it
  useEffect(() => {
    if (open && active >= 0) {
      document
        .querySelector(`#${CSS.escape(`${listId}-${active}`)}`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, active, listId])
  useVisibleViewport(panel ? dialogRef : boxRef, panel ? overlay : focused)

  const reset = () => {
    setQuery('')
    setActive(-1)
    setOverlay(false)
  }
  const close = () => {
    if (panel) {
      // Its close event resets the state
      dialogRef.current?.close()
      return
    }
    reset()
    inputRef.current?.blur()
  }
  const clear = () => {
    setQuery('')
    setActive(-1)
    inputRef.current?.focus()
  }
  const pick = (target: string) => {
    close()
    void navigate(target)
  }

  const results = (className: string) =>
    open && (
      <Results
        query={query}
        active={active}
        listId={listId}
        optionId={optionId}
        onPick={pick}
        className={className}
        inset={panel}
      />
    )

  const field = (
    <form
      data-dock-face
      className='relative min-w-0 flex-1'
      onSubmit={(event) => {
        event.preventDefault()
        if (query.trim() !== '') {
          pick(`/search?q=${encodeURIComponent(query.trim())}`)
        }
      }}>
      <SearchIcon
        aria-hidden
        className='pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground'
      />
      <input
        ref={inputRef}
        data-dock-shell
        type='search'
        role='combobox'
        aria-label='Search Songs'
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete='list'
        aria-activedescendant={
          open && active >= 0 ? optionId(active) : undefined
        }
        enterKeyHint='search'
        placeholder='Search'
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(-1)
        }}
        onFocus={() => {
          setFocused(true)
        }}
        onBlur={(event) => {
          setFocused(false)
          // The keyboard put away (iOS's Done) with nothing typed ends the search; Tab to Cancel does not
          if (panel && query.trim() === '' && event.relatedTarget === null) {
            close()
          }
        }}
        onKeyDown={(event) => {
          // The phone's panel closes and hands focus back to its button; in the bar the field empties and keeps
          // focus, as a combobox does
          if (event.key === 'Escape') {
            event.preventDefault()
            if (panel) {
              close()
            } else {
              clear()
            }
            return
          }
          if (!open) {
            return
          }
          const options =
            document
              .querySelector(`#${CSS.escape(listId)}`)
              ?.querySelectorAll<HTMLElement>('[role=option]') ?? []
          if (
            (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
            options.length > 0
          ) {
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            // From the field, down goes to the first row and up to the last; past either end it wraps
            setActive((current) =>
              current === -1 && step < 0
                ? options.length - 1
                : (current + step + options.length) % options.length
            )
          }
          const target = options[active]?.dataset.target
          if (event.key === 'Enter' && target !== undefined) {
            event.preventDefault()
            pick(target)
          }
        }}
        // 16px text: iOS zooms the page into any field set smaller when it takes focus, and pans it sideways
        className={cn(
          'w-full border border-border bg-background/60 pr-9 pl-10 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring [&::-webkit-search-cancel-button]:hidden',
          panel ? 'h-11 rounded-xl' : 'h-10 rounded-full'
        )}
      />
      {query !== '' && (
        <button
          type='button'
          aria-label='Clear Search'
          // Cleared on the press, which keeps the field focused and the keyboard up: WebKit sends no click
          // after a touch whose pointerdown was cancelled. Click is the keyboard's way
          onPointerDown={(event) => {
            event.preventDefault()
            clear()
          }}
          onClick={clear}
          className='absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground'>
          <XIcon className='size-4' />
        </button>
      )}
    </form>
  )

  if (!panel) {
    return (
      <div ref={boxRef} className='relative mx-4 w-full max-w-xl'>
        {field}
        {results(
          // Above the keyboard on a phone on its side, where the field sits in the bar
          'absolute inset-x-0 top-full z-10 mt-1 max-h-[min(30rem,calc(var(--vv-h,var(--app-h))-var(--safe-top)-4rem),calc(var(--app-h)-var(--safe-top)-var(--safe-bottom)-4rem))] rounded-xl border border-border bg-popover py-2 shadow-lg'
        )}
      </div>
    )
  }

  return (
    <>
      <Button
        ref={triggerRef}
        data-dock-shell
        variant='toolbar'
        size='icon'
        aria-label='Search'
        aria-haspopup='dialog'
        onClick={() => {
          // Opened and focused in the tap itself: iOS raises the keyboard only for a focus a tap makes
          dialogRef.current?.showModal()
          inputRef.current?.focus()
          setOverlay(true)
        }}>
        <SearchIcon className='h-6 w-6 shrink-0' />
      </Button>
      {/* In the body's top layer: the bar's slide and fade, and the tab bar rule that hides its buttons, never
          reach it. It floats under the status bar and inside the side insets, and ends above the keyboard */}
      {createPortal(
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- a press on the backdrop closes the dialog; Escape and Cancel are the keyboard's way
        <dialog
          ref={dialogRef}
          aria-label='Search'
          onClose={() => {
            reset()
            // Back to the button that opened it: a tap never focuses a button in Safari, so the dialog's own
            // return has nowhere to go
            triggerRef.current?.focus({ preventScroll: true })
          }}
          onClick={(event) => {
            const box = dialogRef.current?.getBoundingClientRect()
            if (
              event.target === dialogRef.current &&
              box !== undefined &&
              (event.clientY < box.top ||
                event.clientY > box.bottom ||
                event.clientX < box.left ||
                event.clientX > box.right)
            ) {
              close()
            }
          }}
          className={cn(
            'search-panel flex-col open:flex',
            'rounded-panel border border-transparent bg-popover p-2 text-foreground shadow-panel ring-1 ring-white/10'
          )}>
          <div className='flex items-center gap-1'>
            {field}
            <button
              type='button'
              onClick={close}
              className='h-11 shrink-0 rounded-xl px-3 text-base font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
              Cancel
            </button>
          </div>
          {results('-mx-2 mt-2 min-h-0 flex-1 border-t border-border pt-2')}
        </dialog>,
        document.body
      )}
    </>
  )
}
