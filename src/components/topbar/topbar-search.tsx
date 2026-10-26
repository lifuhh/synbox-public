import {
  ArrowUpRightIcon,
  LinkIcon,
  LoaderCircleIcon,
  SearchIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { ClearFieldButton } from '@/components/ui/clear-field-button'
import {
  useGallerySongs,
  useSearchLibrary,
} from '@/lib/react-query/queries-and-mutations'
import type { LibraryListSong } from '@/lib/synbox-flask/discovery'
import { matchTitles } from '@/lib/title-match'
import { BAD_LINK, readFieldText } from '@/utils'
import type { FieldText } from '@/utils'
import { cn } from '@/utils/cn'

const MAX_SONGS = 6
// The full search waits until typing pauses this long, and asks only from this many characters: each new query can
// spend one of the backend's ranked searches (a daily budget, then plain title matching)
const SEARCH_DELAY_MS = 450
const SEARCH_MIN_CHARS = 2
// A row that leaves the app: opened in a new tab, never by the list's own navigation
const EXTERNAL = 'external:'

export const youtubeSearchUrl = (query: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`

// `value` once it has stayed the same for `ms`
const useSettled = (value: string, ms: number) => {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value)
    }, ms)
    return () => {
      clearTimeout(timer)
    }
  }, [value, ms])
  return settled
}

interface Row {
  target: string
  song?: { videoId: string; title: string; thumbnailUrl: string }
  label?: string
  // A pasted link's row: it opens what the link names
  link?: boolean
}

// One row's face: a song's picture and title, a row that leaves the app (its link opens the new tab), or an action
const RowBody = ({
  row,
  onPick,
}: {
  row: Row
  onPick: (target: string) => void
}) => {
  if (row.song) {
    return (
      <>
        <img
          src={row.song.thumbnailUrl}
          alt=''
          loading='lazy'
          className='aspect-video h-8 shrink-0 rounded-sm bg-thumbnail-placeholder object-cover'
        />
        <span className='min-w-0 flex-1 truncate'>{row.song.title}</span>
      </>
    )
  }
  if (row.target.startsWith(EXTERNAL)) {
    return (
      <a
        href={row.target.slice(EXTERNAL.length)}
        target='_blank'
        rel='noopener noreferrer'
        tabIndex={-1}
        onClick={() => {
          onPick('')
        }}
        className='flex min-w-0 flex-1 items-center gap-3 self-stretch'>
        <span className='grid w-14 shrink-0 place-items-center text-muted-foreground'>
          <ArrowUpRightIcon aria-hidden className='size-4' />
        </span>
        <span className='min-w-0 flex-1 truncate'>
          {row.label}
          <span className='sr-only'> (opens in a new tab)</span>
        </span>
      </a>
    )
  }
  const Icon = row.link === true ? LinkIcon : SearchIcon
  return (
    <>
      <span className='grid w-14 shrink-0 place-items-center text-muted-foreground'>
        <Icon aria-hidden className='size-4' />
      </span>
      <span className='min-w-0 flex-1 truncate'>{row.label}</span>
    </>
  )
}

// A pasted link's one row: our own song opens in place, a YouTube video on the Search page (to play or generate)
const linkRows = (text: FieldText, typed: string): Row[] => {
  if (text.kind === 'own') {
    return [{ label: 'Open Song', link: true, target: text.path }]
  }
  if (text.kind === 'video') {
    return [
      {
        label: 'Open Video',
        link: true,
        target: `/search?q=${encodeURIComponent(typed)}`,
      },
    ]
  }
  return []
}

// What the list's polite live region says: the link's row (or why there is none), or the songs found
const liveText = (
  isLink: boolean,
  rows: Row[],
  searching: boolean,
  found: number
) => {
  if (isLink) {
    return rows[0]?.label ?? BAD_LINK
  }
  if (searching) {
    return 'Searching'
  }
  return `${found} ${found === 1 ? 'song' : 'songs'}`
}

// What the dropdown lists while the field has text. At once: the karaoke songs (the mic badge) whose title or
// channel holds every word. Once typing pauses: the library's ranked search too (the Search page's), karaoke songs
// only, with a Searching… row meanwhile. Then See All Results (the Search page) and Search on YouTube (a new tab).
// A pasted link lists one row instead, which opens it (a YouTube video on the Search page, to play or generate), and
// asks no search. Mounted only while open, so a page that never searches never loads the list
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
  const typed = query.trim()
  const text = readFieldText(typed)
  const isLink = text.kind !== 'search' && text.kind !== 'empty'
  const settled = useSettled(typed, SEARCH_DELAY_MS)
  const asked = !isLink && settled.length >= SEARCH_MIN_CHARS ? settled : ''
  const library = useSearchLibrary(asked)
  const { songs } = useGallerySongs()
  const karaoke = songs.filter((song) => song.karaoke)
  const karaokeIds = new Set(karaoke.map((song) => song.videoId))
  const matches = isLink ? [] : matchTitles(karaoke, typed, MAX_SONGS)
  const seen = new Set(matches.map((song) => song.videoId))
  // The ranked answer only for the words on screen, never a stale query's
  const ranked =
    library.data?.query.trim() === typed
      ? library.data.results.filter(
          (song) => karaokeIds.has(song.video_id) && !seen.has(song.video_id)
        )
      : []
  const found: Row[] = [
    ...matches.map((song: LibraryListSong) => ({
      song,
      target: `/v/${song.videoId}`,
    })),
    ...ranked.map((song) => ({
      song: {
        thumbnailUrl: song.thumbnail_url,
        title: song.title,
        videoId: song.video_id,
      },
      target: `/v/${song.video_id}`,
    })),
  ].slice(0, MAX_SONGS)
  const searching =
    !isLink &&
    typed.length >= SEARCH_MIN_CHARS &&
    (settled !== typed || library.isFetching)
  const rows: Row[] = isLink
    ? linkRows(text, typed)
    : [
        ...found,
        {
          label: 'See All Results',
          target: `/search?q=${encodeURIComponent(typed)}`,
        },
        {
          label: 'Search on YouTube',
          target: `${EXTERNAL}${youtubeSearchUrl(typed)}`,
        },
      ]
  const rowClass = (index: number) =>
    cn(
      'flex h-11 cursor-pointer items-center gap-3 px-3 text-sm text-foreground touch:h-12',
      inset && 'mx-2 rounded-xl px-3.5',
      index === active ? 'bg-accent' : 'hover:bg-accent'
    )
  return (
    <div className={cn('overflow-y-auto overscroll-contain', className)}>
      <p className='sr-only' aria-live='polite'>
        {liveText(isLink, rows, searching, found.length)}
      </p>
      {searching && (
        <div
          aria-hidden
          className={cn(
            'flex h-11 items-center gap-3 px-3 text-sm text-muted-foreground touch:h-12',
            inset && 'mx-2 px-3.5'
          )}>
          <span className='grid w-14 shrink-0 place-items-center'>
            <LoaderCircleIcon className='size-4 animate-spin motion-reduce:animate-none' />
          </span>
          Searching…
        </div>
      )}
      {!searching && (isLink ? rows.length : found.length) === 0 && (
        <p
          className={cn(
            'flex h-11 items-center px-3 text-sm text-muted-foreground touch:h-12',
            inset && 'mx-2 px-3.5'
          )}>
          {text.kind === 'bad' ? BAD_LINK : 'No karaoke songs found'}
        </p>
      )}
      <ul
        id={listId}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- the combobox pattern's popup: a <select> or <datalist> can't hold thumbnails
        role='listbox'
        aria-label='Search Results'>
        {rows.map((row, index) => {
          const external = row.target.startsWith(EXTERNAL)
          return (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the keyboard picks an option from the field (arrows, Enter)
            <li
              key={row.target}
              id={optionId(index)}
              data-target={row.target}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- an option of the listbox above
              role='option'
              aria-selected={index === active}
              // Picked on release, inside the row (a press that slides off picks nothing). The press keeps the field
              // focused (a mouse's, and the mousedown a tap sends as it lifts), so its blur doesn't close the list
              // before the click lands. A row that leaves the app opens from its link's own click
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                if (!external) {
                  onPick(row.target)
                }
              }}
              className={cn(
                rowClass(index),
                !isLink &&
                  index === found.length &&
                  'mt-1 border-t border-border pt-1'
              )}>
              <RowBody row={row} onPick={onPick} />
            </li>
          )
        })}
      </ul>
    </div>
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
  // A song or the Search page in place; a row that leaves the app in a new tab; '' only closes (its link opened it)
  const pick = (target: string) => {
    close()
    if (target.startsWith(EXTERNAL)) {
      window.open(
        target.slice(EXTERNAL.length),
        '_blank',
        'noopener,noreferrer'
      )
    } else if (target !== '') {
      void navigate(target)
    }
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
        const text = readFieldText(query)
        if (text.kind === 'own') {
          pick(text.path)
        } else if (text.kind !== 'empty') {
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
        placeholder={
          panel ? 'Search or Paste a Link' : 'Search or Paste a YouTube Link'
        }
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
          // Enter takes the highlighted row, else the top song, or with none, Search on YouTube (the last row)
          const firstIsSong =
            options[0]?.dataset.target?.startsWith('/v/') === true
          let index = options.length - 1
          if (active >= 0) {
            index = active
          } else if (firstIsSong) {
            index = 0
          }
          const target = options[index]?.dataset.target
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
      <ClearFieldButton
        field={inputRef}
        value={query}
        onClear={clear}
        className='absolute top-1/2 right-2 -translate-y-1/2'
      />
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
              className='h-11 shrink-0 rounded-xl px-3 text-base font-medium text-foreground transition-colors duration-150 hover:bg-accent'>
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
