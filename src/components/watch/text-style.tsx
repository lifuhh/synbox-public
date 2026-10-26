import { atom, useAtom, useAtomValue } from 'jotai'
import { ALargeSmallIcon } from 'lucide-react'
import { useRef } from 'react'

import { SEGMENT } from '@/components/lyrics-display/lyrics-style-scope'
import { StyleSwitch } from '@/components/lyrics-display/style-switch'
import { useVideoColor } from '@/components/offline/reader-controls'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { translationIsEnglishAtom } from '@/context/atoms'
import { useMediaQuery } from '@/hooks/use-media-query'
import { MENU_GAP } from '@/lib/menu-offset'
import type { ReaderColor, ReaderLayer } from '@/lib/offline/reader-prefs'
import {
  READER_COLORS,
  READER_SIZES,
  readerColor,
  readerPrefsAtom,
} from '@/lib/offline/reader-prefs'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

// One Text Style panel open at a time, whichever button opened it (the panel's header, the band's corner)
const textStyleOpenAtom = atom(false)

const SECTION_HEADING =
  'text-xs font-medium tracking-wide text-muted-foreground uppercase'

const LINES: { id: ReaderLayer; label: string }[] = [
  { id: 'japanese', label: 'Japanese' },
  { id: 'romaji', label: 'Romaji' },
  { id: 'translation', label: 'Translation' },
]

const LANGUAGES = [
  { english: true, label: 'English' },
  { english: false, label: '中文' },
] as const

// Which lines the page shows, one always on so it is never blank, and the translation's language (the video's
// too). Picking a language shows the translation
const LinesSection = () => {
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  const [english, setEnglish] = useAtom(translationIsEnglishAtom)
  const shown = LINES.filter((line) => prefs[line.id]).length
  return (
    <section className='flex flex-col gap-2'>
      <h3 className={SECTION_HEADING}>Lines</h3>
      <div className='flex flex-col'>
        {LINES.map((line) => (
          <StyleSwitch
            key={line.id}
            label={line.label}
            checked={prefs[line.id]}
            disabled={prefs[line.id] && shown === 1}
            onChange={(on) => {
              setPrefs({ [line.id]: on })
            }}
          />
        ))}
      </div>
      <div
        role='radiogroup'
        aria-label='Translation Language'
        className='grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1'>
        {LANGUAGES.map((option) => {
          const selected = english === option.english
          return (
            <button
              key={option.label}
              type='button'
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- segmented buttons in an ARIA radio group, like Lyrics Style's scope
              role='radio'
              aria-checked={selected}
              onClick={() => {
                setEnglish(option.english)
                setPrefs({ translation: true })
              }}
              className={cn(
                SEGMENT,
                selected
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              {option.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

// The size in the reader's steps, and bold. The band under the video on an upright phone keeps one size
const TypeSection = ({ sized }: { sized: boolean }) => {
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  return (
    <div className='flex flex-col gap-2'>
      {sized && (
        <section className='flex flex-col gap-2'>
          <h3 className={SECTION_HEADING}>Size</h3>
          <div className='flex items-center gap-3'>
            <span
              aria-hidden='true'
              className='text-xs font-semibold text-muted-foreground'>
              A
            </span>
            <Slider
              aria-label='Text Size'
              min={0}
              max={READER_SIZES.length - 1}
              step={1}
              value={[prefs.size]}
              onValueChange={([size]) => {
                if (size !== undefined) {
                  setPrefs({ size })
                }
              }}
              className='flex-1 cursor-pointer'
            />
            <span
              aria-hidden='true'
              className='text-lg font-semibold text-muted-foreground'>
              A
            </span>
          </div>
        </section>
      )}
      <StyleSwitch
        label='Bold'
        checked={prefs.bold}
        onChange={(bold) => {
          setPrefs({ bold })
        }}
      />
    </div>
  )
}

// A colour as the page draws it: its Japanese on the panel's own surface
const ColorTile = ({
  label,
  color,
  selected,
  onSelect,
}: {
  label: string
  color: string
  selected: boolean
  onSelect: () => void
}) => {
  const tileVars: CssVars = { '--tile-ink': color }
  return (
    <button
      type='button'
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- tiles in an ARIA radio group, like Lyrics Style's colours
      role='radio'
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      data-focus-proxy
      // The label clears the selected ring (2px out past a 2px offset)
      className='group flex min-w-0 flex-col items-center gap-2'>
      <span
        style={tileVars}
        className={cn(
          'focus-target relative flex h-11 w-full items-center justify-center rounded-md bg-card ring-2 ring-offset-2 ring-offset-popover transition-shadow duration-150',
          selected
            ? 'ring-foreground'
            : 'ring-transparent group-hover:ring-border'
        )}>
        {/* Too small a tile for Lyrics Style's check badge, which would sit on the glyph: the ring alone marks it */}
        <span className='font-reader text-xl leading-none font-bold text-(--tile-ink)'>
          あ
        </span>
      </span>
      <span
        className={cn(
          'text-xs leading-none',
          selected ? 'text-foreground' : 'text-muted-foreground'
        )}>
        {label}
      </span>
    </button>
  )
}

// The Japanese line's colour: Video follows Lyrics Style's, the rest are the page's own. A preset applies and
// closes, like a menu; Custom stays open on its hue until Done
const ColorSection = ({ onPick }: { onPick: () => void }) => {
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  const video = useVideoColor()
  const colorOf = (id: ReaderColor) =>
    readerColor({ id, prefs, theme: 'dark', video }) ?? 'var(--foreground)'
  return (
    <section className='flex flex-col gap-2'>
      <h3 className={SECTION_HEADING}>Colour</h3>
      <div
        role='radiogroup'
        aria-label='Japanese Colour'
        className='grid grid-cols-5 gap-x-2'>
        {READER_COLORS.map((color) => (
          <ColorTile
            key={color.id}
            label={color.label}
            color={colorOf(color.id)}
            selected={prefs.color === color.id}
            onSelect={() => {
              setPrefs({ color: color.id })
              onPick()
            }}
          />
        ))}
        <ColorTile
          label='Custom'
          color={colorOf('custom')}
          selected={prefs.color === 'custom'}
          onSelect={() => {
            setPrefs({ color: 'custom' })
          }}
        />
      </div>
      {prefs.color === 'custom' && (
        <div className='mt-1 flex items-center gap-3'>
          <input
            type='range'
            aria-label='Hue'
            min={0}
            max={359}
            step={1}
            value={prefs.hue}
            onChange={(event) => {
              setPrefs({ hue: Number(event.target.value) })
            }}
            className='lyrics-hue-slider min-w-0 flex-1 bg-hue-track'
          />
          <button
            type='button'
            onClick={onPick}
            className='shrink-0 rounded-full bg-primary-subtle px-2.5 py-1 text-xs font-semibold text-primary-text transition-colors hover:bg-primary-subtle-hover touch:px-3.5 touch:py-2 touch:text-sm'>
            Done
          </button>
        </div>
      )}
    </section>
  )
}

const TextStyleControls = ({
  sized,
  onPick,
}: {
  sized: boolean
  onPick: () => void
}) => (
  <>
    <LinesSection />
    <TypeSection sized={sized} />
    <ColorSection onPick={onPick} />
  </>
)

// How the lyrics on the page look (src/lib/offline/reader-prefs.ts), apart from Lyrics Style's over the video. Either
// way the lyrics it changes stay in view: with a mouse a popover beside its button, out over the video (left of the
// header's button at the panel's leading edge, above the corner's button at the panel's top); on a touch screen a
// sheet. `corner`: the round filled button over the lines (the band, the panel under a narrow video); otherwise a
// header's plain one. `sized`: false on the band, whose size is fixed
export const TextStyleButton = ({
  corner = false,
  sized = true,
}: {
  corner?: boolean
  sized?: boolean
}) => {
  const [open, setOpen] = useAtom(textStyleOpenAtom)
  const touch = useMediaQuery('(pointer: coarse)')
  // Focus moves in, and back to the button on close, only for a panel opened from the keyboard
  const fromKeyboardRef = useRef(false)
  const close = () => {
    setOpen(false)
  }
  const button = (
    <Button
      variant={corner ? 'surface-icon' : 'toolbar'}
      size='icon'
      aria-label='Text Style'
      title='Text Style'
      aria-expanded={open}
      onClick={(event) => {
        fromKeyboardRef.current = event.detail === 0
        setOpen(!open)
      }}
      className='touch:size-11'>
      <ALargeSmallIcon className='size-5' />
    </Button>
  )

  if (touch) {
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            close()
          }
        }}>
        {button}
        <DialogContent
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
          }}
          variant='sheet'>
          {/* As Lyrics Style's sheet: the title row stays while the controls scroll under it, beside the Close */}
          <div className='flex min-h-6 flex-none items-center p-4 pr-14 pb-2'>
            <DialogTitle size='sm'>Text Style</DialogTitle>
          </div>
          <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,#000_0.5rem)] px-4 pt-2 pb-4 unhighlightable'>
            <TextStyleControls sized={sized} onPick={close} />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close()
        }
      }}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        side={corner ? 'top' : 'left'}
        align={corner ? 'end' : 'start'}
        // Left of the header's button: 4px clear of the panel's edge (the button sits 6px inside it), and within the
        // 12px a menu may sit from its button (detachedMenus)
        sideOffset={corner ? MENU_GAP : MENU_GAP + 4}
        collisionPadding={8}
        onOpenAutoFocus={(event) => {
          if (!fromKeyboardRef.current) {
            event.preventDefault()
          }
        }}
        onCloseAutoFocus={(event) => {
          if (!fromKeyboardRef.current) {
            event.preventDefault()
          }
          fromKeyboardRef.current = false
        }}
        aria-label='Text Style'
        variant='floating'
        className='z-300 max-h-(--radix-popover-content-available-height) w-[min(21rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain'>
        <div className='flex flex-col gap-4 p-4 unhighlightable'>
          <div className='flex min-h-6 items-center'>
            <h2 className='text-sm font-semibold'>Text Style</h2>
          </div>
          <TextStyleControls sized={sized} onPick={close} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// The page's lines as Text Style sets them, for LyricsPanel: the Japanese colour on the dark watch page, and the
// size on top of the panel's own
export const useTextStyle = () => {
  const prefs = useAtomValue(readerPrefsAtom)
  const video = useVideoColor()
  return {
    accent:
      readerColor({ id: prefs.color, prefs, theme: 'dark', video }) ??
      'var(--reader-fg)',
    scale: READER_SIZES[prefs.size] ?? 1,
  }
}
