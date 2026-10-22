import { ArrowLeftIcon, SearchIcon, XIcon } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { useGallerySongs } from '@/lib/react-query/queries-and-mutations'
import type { LibraryListSong } from '@/lib/synbox-flask/discovery'
import { matchTitles } from '@/lib/title-match'
import { cn } from '@/utils/cn'

const MAX_SONGS = 8

// What the dropdown lists while the field has text: the library's songs whose title or channel holds every word,
// then the full search for the words. Mounted only while open, so a page that never searches never loads the list
const Results = ({
  query,
  active,
  listId,
  optionId,
  onPick,
}: {
  query: string
  active: number
  listId: string
  optionId: (index: number) => string
  onPick: (target: string) => void
}) => {
  const { songs } = useGallerySongs()
  const matches = matchTitles(songs, query, MAX_SONGS)
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
      className='absolute inset-x-0 top-full z-10 mt-1 max-h-[min(30rem,calc(var(--app-h)-5rem))] overflow-y-auto rounded-xl border border-border bg-popover py-2 shadow-lg'>
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

// A search field with an instant dropdown, as on YouTube. `inline` is the field in the bar on a wide screen;
// `button` is a phone's search button, which opens the same field over the whole bar
export const TopbarSearch = ({ variant }: { variant: 'inline' | 'button' }) => {
  const navigate = useNavigate()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const [active, setActive] = useState(-1)
  const open = focused && query.trim() !== ''
  const optionId = (index: number) => `${listId}-${index}`

  const close = () => {
    setQuery('')
    setActive(-1)
    setOverlay(false)
    inputRef.current?.blur()
  }
  const pick = (target: string) => {
    close()
    void navigate(target)
  }

  if (variant === 'button' && !overlay) {
    return (
      <Button
        variant='toolbar'
        size='icon'
        aria-label='Search'
        onClick={() => {
          setOverlay(true)
        }}>
        <SearchIcon className='h-6 w-6 shrink-0' />
      </Button>
    )
  }

  return (
    <div
      className={cn(
        variant === 'inline'
          ? 'relative mx-4 w-full max-w-xl'
          : 'absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-2 bg-background px-2'
      )}>
      {variant === 'button' && (
        <Button
          variant='toolbar'
          size='icon'
          aria-label='Close Search'
          onPointerDown={(event) => {
            event.preventDefault()
          }}
          onClick={close}>
          <ArrowLeftIcon className='h-6 w-6 shrink-0' />
        </Button>
      )}
      <form
        className='relative flex-1'
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
          type='search'
          role='combobox'
          aria-label='Search Songs'
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete='list'
          aria-activedescendant={
            open && active >= 0 ? optionId(active) : undefined
          }
          // A phone's field opens to type in at once
          autoFocus={variant === 'button'}
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
          onBlur={() => {
            setFocused(false)
            if (variant === 'button' && query.trim() === '') {
              setOverlay(false)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              close()
              return
            }
            if (!open) {
              return
            }
            const options =
              inputRef.current?.form?.querySelectorAll<HTMLElement>(
                '[role=option]'
              ) ?? []
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
          className='h-10 w-full rounded-full border border-border bg-background/60 pr-9 pl-10 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring [&::-webkit-search-cancel-button]:hidden'
        />
        {query !== '' && (
          <button
            type='button'
            aria-label='Clear Search'
            onPointerDown={(event) => {
              event.preventDefault()
            }}
            onClick={() => {
              setQuery('')
              setActive(-1)
              inputRef.current?.focus()
            }}
            className='absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground'>
            <XIcon className='size-4' />
          </button>
        )}
        {open && (
          <Results
            query={query}
            active={active}
            listId={listId}
            optionId={optionId}
            onPick={pick}
          />
        )}
      </form>
    </div>
  )
}
