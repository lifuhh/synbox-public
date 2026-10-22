import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { CheckIcon, MinusIcon, PlusIcon, XIcon } from 'lucide-react'
import { useId, useState } from 'react'

import {
  applyLyricsTemplateAtom,
  applySongLyricsStyleToAllAtom,
  deleteLyricsTemplateAtom,
  lyricsScreenSizesAtom,
  lyricsStyleAtom,
  lyricsStyleScopeAtom,
  lyricsStyleSourceAtom,
  lyricsTemplatesAtom,
  resetSongLyricsStyleAtom,
  saveLyricsTemplateAtom,
} from '@/context/atoms'
import type { LyricsStyleScope } from '@/context/atoms'
import { useLyricsSurface } from '@/hooks/use-media-query'
import type { LyricsSurface } from '@/lib/lyrics-style'
import {
  MAX_LYRICS_TEMPLATES,
  SCREEN_SIZE_MAX,
  SCREEN_SIZE_MIN,
  TEMPLATE_NAME_MAX,
  sameSavedLyricsStyle,
} from '@/lib/lyrics-style'
import { cn } from '@/utils/cn'

const SECTION_HEADING =
  'text-xs font-medium tracking-wide text-muted-foreground uppercase'
// A choice in a segmented track (rounded-lg, p-1): its corners are the track's less the padding
const SEGMENT =
  'rounded-sm py-1.5 text-xs font-medium transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden touch:py-2.5 touch:text-sm'
const TEXT_BUTTON =
  'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden touch:px-3 touch:py-2.5 touch:text-sm'

const SCOPES: { id: LyricsStyleScope; name: string }[] = [
  { id: 'all', name: 'All Songs' },
  { id: 'song', name: 'This Song' },
]

// Where the panel's changes (and a drag of the lyrics) go, and the two ways out of a song's own style
export const LyricsStyleScopeSection = () => {
  const [scope, setScope] = useAtom(lyricsStyleScopeAtom)
  const source = useAtomValue(lyricsStyleSourceAtom)
  const saveAsDefault = useSetAtom(applySongLyricsStyleToAllAtom)
  const resetSong = useSetAtom(resetSongLyricsStyleAtom)
  if (source === null) {
    return null
  }
  const ownStyle = source !== 'default'
  // Only what the buttons above don't already say
  let note: string | null = null
  if (source === 'shared') {
    note = 'Shared style. Edits stay on this song'
  } else if (scope === 'all' && ownStyle) {
    note = 'This song keeps its own tweaks'
  }
  return (
    <section className='flex flex-col gap-2'>
      {/* A change to a shared style keeps it for this song, so there is no choice to make while it shows */}
      {source !== 'shared' && (
        <>
          <h3 id='lyrics-style-scope' className={SECTION_HEADING}>
            Changes Apply To
          </h3>
          <div
            role='radiogroup'
            aria-labelledby='lyrics-style-scope'
            className='grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1'>
            {SCOPES.map((option) => (
              <button
                key={option.id}
                type='button'
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- segmented buttons in an ARIA radio group, like the backdrop picker
                role='radio'
                aria-checked={scope === option.id}
                onClick={() => {
                  setScope(option.id)
                }}
                className={cn(
                  SEGMENT,
                  scope === option.id
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}>
                {option.name}
              </button>
            ))}
          </div>
        </>
      )}
      {note !== null && <p className='text-xs text-muted-foreground'>{note}</p>}
      {ownStyle && (
        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            onClick={saveAsDefault}
            className={cn(
              TEXT_BUTTON,
              'bg-primary-subtle text-primary-text hover:bg-primary-subtle-hover'
            )}>
            Save as My Default
          </button>
          <button
            type='button'
            onClick={resetSong}
            className={cn(
              TEXT_BUTTON,
              'bg-secondary text-foreground hover:bg-accent'
            )}>
            Reset This Song to My Default
          </button>
        </div>
      )}
    </section>
  )
}

const SURFACE_NAMES: Record<LyricsSurface, string> = {
  desktop: 'Desktop',
  landscape: 'Landscape',
  portrait: 'Portrait',
}
const SCREEN_SIZE_STEP = 0.05

// The size slider sets one size for every screen (each scales it to fit); this nudges the screen in use on
// its own
export const ScreenSizeTweak = () => {
  const surface = useLyricsSurface()
  const [sizes, setSizes] = useAtom(lyricsScreenSizesAtom)
  const value = sizes[surface]
  const name = SURFACE_NAMES[surface]
  const nudge = (by: number) => {
    const next = Math.round((value + by) * 100) / 100
    setSizes({
      ...sizes,
      [surface]: Math.min(SCREEN_SIZE_MAX, Math.max(SCREEN_SIZE_MIN, next)),
    })
  }
  const stepper =
    'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden disabled:opacity-40 touch:size-11'
  return (
    <div className='flex items-center justify-between gap-2'>
      <p aria-hidden='true' className='text-xs text-muted-foreground'>
        Only on {name}
      </p>
      <fieldset className='flex shrink-0 items-center'>
        <legend className='sr-only'>Size on {name} Only</legend>
        <button
          type='button'
          aria-label={`Smaller on ${name}`}
          disabled={value <= SCREEN_SIZE_MIN}
          onClick={() => {
            nudge(-SCREEN_SIZE_STEP)
          }}
          className={stepper}>
          <MinusIcon className='size-4 shrink-0' />
        </button>
        <output
          aria-live='polite'
          className='w-11 text-center text-xs text-foreground tabular-nums'>
          {Math.round(value * 100)}%
        </output>
        <button
          type='button'
          aria-label={`Larger on ${name}`}
          disabled={value >= SCREEN_SIZE_MAX}
          onClick={() => {
            nudge(SCREEN_SIZE_STEP)
          }}
          className={stepper}>
          <PlusIcon className='size-4 shrink-0' />
        </button>
      </fieldset>
    </div>
  )
}

// Named styles to reuse on any song. A pick applies where changes go (this song, or every song) and closes
// the panel, like the colour presets. The one on screen shows as picked, as the colour tiles do
export const MyStyles = ({ onApplied }: { onApplied: () => void }) => {
  const templates = useAtomValue(lyricsTemplatesAtom)
  const current = useAtomValue(lyricsStyleAtom)
  const apply = useSetAtom(applyLyricsTemplateAtom)
  const remove = useSetAtom(deleteLyricsTemplateAtom)
  const save = useSetAtom(saveLyricsTemplateAtom)
  const [naming, setNaming] = useState(false)
  const inputId = useId()
  const full = templates.length >= MAX_LYRICS_TEMPLATES

  let suggested = templates.length + 1
  while (templates.some((t) => t.name === `Style ${suggested}`)) {
    suggested += 1
  }

  return (
    <section className='flex flex-col gap-2'>
      <h3 className={SECTION_HEADING}>My Styles</h3>
      {templates.length > 0 && (
        <ul className='flex flex-wrap gap-1.5'>
          {templates.map((template) => {
            const selected = sameSavedLyricsStyle(template.style, current)
            return (
              <li
                key={template.id}
                className={cn(
                  'flex items-center rounded-full ring-2 transition-colors',
                  selected
                    ? 'bg-accent ring-foreground'
                    : 'bg-secondary ring-transparent'
                )}>
                <button
                  type='button'
                  aria-pressed={selected}
                  onClick={() => {
                    apply(template.id)
                    onApplied()
                  }}
                  className={cn(
                    'flex max-w-40 items-center gap-1 rounded-full py-1.5 pr-1 text-xs font-medium text-foreground transition-colors hover:text-primary-text focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden touch:py-2.5 touch:text-sm',
                    selected ? 'pl-2' : 'pl-3'
                  )}>
                  {selected && <CheckIcon className='size-3.5 shrink-0' />}
                  <span className='truncate'>{template.name}</span>
                </button>
                <button
                  type='button'
                  aria-label={`Delete ${template.name}`}
                  onClick={() => {
                    remove(template.id)
                  }}
                  className='flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden touch:size-10'>
                  <XIcon className='size-3.5 shrink-0' />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {naming ? (
        <form
          className='flex items-center gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            const field = new FormData(event.currentTarget).get('name')
            const name = typeof field === 'string' ? field.trim() : ''
            if (name !== '') {
              save(name.slice(0, TEMPLATE_NAME_MAX))
            }
            setNaming(false)
          }}>
          <label htmlFor={inputId} className='sr-only'>
            Style Name
          </label>
          <input
            id={inputId}
            name='name'
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the Save button, to type the name at once
            autoFocus
            defaultValue={`Style ${suggested}`}
            maxLength={TEMPLATE_NAME_MAX}
            autoComplete='off'
            onFocus={(event) => {
              event.currentTarget.select()
            }}
            onKeyDown={(event) => {
              // Escape cancels the name, not the whole panel
              if (event.key === 'Escape') {
                event.stopPropagation()
                setNaming(false)
              }
            }}
            className='h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-xs text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden touch:h-11 touch:text-base'
          />
          <button
            type='submit'
            className={cn(
              TEXT_BUTTON,
              'bg-primary-subtle text-primary-text hover:bg-primary-subtle-hover'
            )}>
            Save
          </button>
        </form>
      ) : (
        <div className='flex items-center gap-2'>
          <button
            type='button'
            disabled={full}
            onClick={() => {
              setNaming(true)
            }}
            className={cn(
              TEXT_BUTTON,
              'bg-secondary text-foreground hover:bg-accent disabled:opacity-50'
            )}>
            Save Current Style
          </button>
          {full && (
            <p className='text-xs text-muted-foreground'>
              Delete one to save another.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
