import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { CheckIcon, XIcon } from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/components/ui/use-toast'
import {
  applyLyricsTemplateAtom,
  applySongLyricsStyleToAllAtom,
  resetLyricsPositionsAtom,
  deleteLyricsTemplateAtom,
  lyricsStyleAtom,
  lyricsStyleScopeAtom,
  lyricsStyleSourceAtom,
  lyricsTemplatesAtom,
  resetSongLyricsStyleAtom,
  saveLyricsTemplateAtom,
} from '@/context/atoms'
import type { LyricsStyleScope } from '@/context/atoms'
import {
  MAX_LYRICS_TEMPLATES,
  TEMPLATE_NAME_MAX,
  sameSavedLyricsStyle,
} from '@/lib/lyrics-style'
import { cn } from '@/utils/cn'

const SECTION_HEADING =
  'text-xs font-medium tracking-wide text-muted-foreground uppercase'
// A choice in a segmented track (rounded-lg, p-1): its corners are the track's less the padding
const SEGMENT =
  'rounded-sm py-1.5 text-xs font-medium transition-colors touch:py-2.5 touch:text-sm'
const TEXT_BUTTON =
  'rounded-lg px-2 py-2 text-xs font-medium transition-colors touch:py-2.5 touch:text-sm'

// A style change that drops what was there, with the app's short Undo toast (as removing a song from the queue)
const offerUndo = (title: string, undo: (() => void) | null) => {
  if (undo === null) {
    return
  }
  toast({
    action: (
      <ToastAction altText={`Undo: ${title}`} onClick={undo}>
        Undo
      </ToastAction>
    ),
    duration: 5000,
    title,
  })
}

const SCOPES: { id: LyricsStyleScope; name: string }[] = [
  { id: 'all', name: 'All Songs' },
  { id: 'song', name: 'This Song' },
]

// Where the panel's changes (and a drag of the lyrics) go, and the two ways out of a song's own style
export const LyricsStyleScopeSection = () => {
  const [scope, setScope] = useAtom(lyricsStyleScopeAtom)
  const source = useAtomValue(lyricsStyleSourceAtom)
  const saveAsDefault = useSetAtom(applySongLyricsStyleToAllAtom)
  const resetPositions = useSetAtom(resetLyricsPositionsAtom)
  const resetSong = useSetAtom(resetSongLyricsStyleAtom)
  if (source === null) {
    return null
  }
  const ownStyle = source !== 'default'
  return (
    <section className='flex flex-col gap-2'>
      {/* No visible heading: "All Songs" and "This Song" say what they choose */}
      <div
        role='radiogroup'
        aria-label='Changes Apply To'
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
      {ownStyle && (
        <div className='grid grid-cols-2 gap-2'>
          <button
            type='button'
            onClick={() => {
              offerUndo('Applied to All Songs', saveAsDefault())
            }}
            className={cn(
              TEXT_BUTTON,
              'bg-primary-subtle text-primary-text hover:bg-primary-subtle-hover'
            )}>
            Apply to All Songs
          </button>
          <button
            type='button'
            onClick={() => {
              offerUndo('Song Style Reset', resetSong())
            }}
            className={cn(
              TEXT_BUTTON,
              'bg-secondary text-foreground hover:bg-accent'
            )}>
            Reset This Song
          </button>
        </div>
      )}
      {/* Where the lyrics and their translation sit, whatever else the style is: back to the start in one tap */}
      <button
        type='button'
        onClick={() => {
          offerUndo('Positions Reset', resetPositions())
        }}
        className={cn(
          TEXT_BUTTON,
          'bg-secondary text-foreground hover:bg-accent'
        )}>
        Reset Positions
      </button>
    </section>
  )
}

// Named styles to reuse on any song. A pick applies where changes go (this song, or every song) and closes
// the panel, like the colour presets. The one on screen shows as picked, as the colour tiles do
export const MyStyles = ({ onApplied }: { onApplied: () => void }) => {
  const templates = useAtomValue(lyricsTemplatesAtom)
  const current = useAtomValue(lyricsStyleAtom)
  const apply = useSetAtom(applyLyricsTemplateAtom)
  const remove = useSetAtom(deleteLyricsTemplateAtom)
  if (templates.length === 0) {
    return null
  }
  return (
    <section className='flex flex-col gap-2'>
      <h3 className={SECTION_HEADING}>My Styles</h3>
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
                  'flex max-w-40 items-center gap-1 rounded-full py-1.5 pr-1 text-xs font-medium text-foreground transition-colors hover:text-primary-text touch:py-2.5 touch:text-sm',
                  selected ? 'pl-2' : 'pl-3'
                )}>
                {selected && <CheckIcon className='size-3.5 shrink-0' />}
                <span className='truncate'>{template.name}</span>
              </button>
              <button
                type='button'
                aria-label={`Delete ${template.name}`}
                onClick={() => {
                  offerUndo(`${template.name} Deleted`, remove(template.id))
                }}
                className='flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground touch:size-10'>
                <XIcon className='size-3.5 shrink-0' />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const FOOTER_BUTTON = 'shrink-0 touch:h-11'

// The panel's last row, under My Styles where a saved style lands; it scrolls with the panel and becomes the name
// field in place. Not pinned: a sticky footer covered a row of the panel wherever it scrolled, and on the Lock
// Landscape page (turned by CSS) iOS pinned it mid-panel (owner, 2026-10-26)
export const SaveStyle = () => {
  const templates = useAtomValue(lyricsTemplatesAtom)
  const save = useSetAtom(saveLyricsTemplateAtom)
  const [naming, setNaming] = useState(false)
  const inputId = useId()
  const full = templates.length >= MAX_LYRICS_TEMPLATES

  let suggested = templates.length + 1
  while (templates.some((t) => t.name === `Style ${suggested}`)) {
    suggested += 1
  }

  return (
    <div className='flex items-center gap-2'>
      {naming ? (
        <form
          className='flex flex-1 items-center gap-2'
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
            className='h-10 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm text-foreground touch:h-11 touch:text-base'
          />
          <Button type='submit' className={FOOTER_BUTTON}>
            Save
          </Button>
        </form>
      ) : (
        <>
          {full && (
            <p className='text-xs text-muted-foreground'>
              Delete one to save another.
            </p>
          )}
          <Button
            disabled={full}
            onClick={() => {
              setNaming(true)
            }}
            className={cn('ml-auto', FOOTER_BUTTON)}>
            Save Current Style
          </Button>
        </>
      )}
    </div>
  )
}
