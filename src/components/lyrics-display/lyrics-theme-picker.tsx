import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { CheckIcon, PaletteIcon } from 'lucide-react'
import type { CSSProperties, RefObject } from 'react'
import { useRef } from 'react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import {
  applySongLyricsStyleToAllAtom,
  fontSizeMultiplierAtom,
  lyricsBackdropAtom,
  lyricsCustomHueAtom,
  lyricsStylePanelAtom,
  lyricsStyleSourceAtom,
  lyricsThemeIdAtom,
  resetSongLyricsStyleAtom,
} from '@/context/atoms'
import type { LyricsStyleSource } from '@/context/atoms'
import { useMediaQuery, usePortrait } from '@/hooks/use-media-query'
import type { LyricsThemeColors } from '@/lib/lyrics-themes'
import {
  LYRICS_BACKDROPS,
  LYRICS_THEMES,
  getCustomThemeColors,
} from '@/lib/lyrics-themes'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import { RailButton, RailTooltip } from './rail-button'

const HALF_FILLED: CSSProperties & Record<'--p', number> = { '--p': 0.5 }

interface ThemeSwatchProps {
  name: string
  colors: LyricsThemeColors
  selected: boolean
  onSelect: () => void
}

const ThemeSwatch = ({
  name,
  colors,
  selected,
  onSelect,
}: ThemeSwatchProps) => {
  const themeVars: CssVars = {
    '--lyric-accent': colors.accent,
    '--lyric-glow': colors.glow,
  }
  return (
    <button
      type='button'
      role='radio'
      aria-checked={selected}
      aria-label={name}
      onClick={onSelect}
      className='group flex flex-col items-center gap-1 focus-visible:outline-hidden'>
      <span
        className={cn(
          'relative flex h-11 w-14 items-center justify-center overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-popover transition-all duration-150 bg-theme-swatch',
          selected
            ? 'ring-primary'
            : 'ring-transparent group-hover:ring-border group-focus-visible:ring-ring'
        )}
        style={themeVars}>
        {/* Caught mid-wipe, so the swatch shows both the white and the theme's accent */}
        <span className='lyric-text-line font_noto_sans_jp_black_900 text-2xl leading-none'>
          <span className='lyric-karaoke-line'>
            <span className='lyric-karaoke-part' style={HALF_FILLED}>
              <span className='lyric-karaoke-fill'>あ</span>
            </span>
          </span>
        </span>
        {selected && (
          <span className='absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white'>
            <CheckIcon className='size-3 shrink-0' />
          </span>
        )}
      </span>
      <span
        className={cn(
          'text-xs leading-none',
          selected ? 'text-foreground' : 'text-muted-foreground'
        )}>
        {name}
      </span>
    </button>
  )
}

const SOURCE_NOTES: Record<LyricsStyleSource, string> = {
  default: 'This song uses your default style.',
  shared: 'Showing the style this link was shared with.',
  song: 'Style and position are saved for this song.',
}

// A discrete pick (a preset colour, a backdrop) applies and closes, like a menu. Size and the custom hue
// are adjusted by dragging and previewed live, so those keep the panel open until Done, Escape or a click
// outside. The panel centers on the rail (`anchorRef`) rather than on its button. With a mouse, resting on
// the button peeks the panel open (`peek`), and the panel stays while the pointer is on either
export const LyricsThemePicker = ({
  anchorRef,
  peek,
}: {
  anchorRef: RefObject<HTMLElement | null>
  peek: {
    enter: (fromButton: boolean) => void
    leave: (fromButton: boolean) => void
  }
}) => {
  const [panel, setPanel] = useAtom(lyricsStylePanelAtom)
  const portrait = usePortrait()
  const touch = useMediaQuery('(pointer: coarse)')
  // Focus moves in, and back to the button on close, only for a panel opened from the keyboard; after a
  // hover or a click it would pop the button's tooltip and hold the player's UI open
  const fromKeyboardRef = useRef(false)
  const close = () => {
    setPanel('closed')
  }
  const [fontSize, setFontSize] = useAtom(fontSizeMultiplierAtom)
  const [themeId, setThemeId] = useAtom(lyricsThemeIdAtom)
  const [customHue, setCustomHue] = useAtom(lyricsCustomHueAtom)
  const [backdrop, setBackdrop] = useAtom(lyricsBackdropAtom)
  const source = useAtomValue(lyricsStyleSourceAtom)
  const ownStyle = source === 'shared' || source === 'song'
  const resetSongStyle = useSetAtom(resetSongLyricsStyleAtom)
  const applyToAll = useSetAtom(applySongLyricsStyleToAllAtom)

  const activeBackdrop = LYRICS_BACKDROPS.find((b) => b.id === backdrop)

  const heading = touch ? (
    <DialogTitle size='sm'>Lyrics Style</DialogTitle>
  ) : (
    <h2 className='text-sm font-semibold'>Lyrics Style</h2>
  )
  const body = (
    <div className='flex flex-col gap-4 p-4 unhighlightable'>
      <div className='flex items-center justify-between touch:pr-10'>
        {heading}
        <button
          type='button'
          onClick={resetSongStyle}
          disabled={!ownStyle}
          className='-my-2 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0 touch:text-sm'>
          Reset
        </button>
      </div>

      <section className='flex flex-col gap-2'>
        <h3 className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
          Size
        </h3>
        <div className='flex items-center gap-3'>
          <span
            aria-hidden='true'
            className='text-xs font-semibold text-muted-foreground'>
            A
          </span>
          <Slider
            aria-label='Lyrics Size'
            min={0.4}
            max={1.6}
            step={0.01}
            value={[fontSize]}
            onValueChange={([value]) => {
              if (value !== undefined) {
                setFontSize(value)
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

      <section className='flex flex-col gap-2'>
        <h3 className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
          Colour
        </h3>
        <div
          role='radiogroup'
          aria-label='Lyrics colour'
          className='grid grid-cols-4 gap-x-2 gap-y-3'>
          {LYRICS_THEMES.map((theme) => (
            <ThemeSwatch
              key={theme.id}
              name={theme.name}
              colors={theme}
              selected={themeId === theme.id}
              onSelect={() => {
                setThemeId(theme.id)
                close()
              }}
            />
          ))}
          <ThemeSwatch
            name='Custom'
            colors={getCustomThemeColors(customHue)}
            selected={themeId === 'custom'}
            onSelect={() => {
              setThemeId('custom')
            }}
          />
        </div>

        {themeId === 'custom' && (
          <div className='mt-1 flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <label
                htmlFor='lyrics-custom-hue'
                className='text-xs text-muted-foreground'>
                Hue
              </label>
              <button
                type='button'
                onClick={() => {
                  close()
                }}
                className='rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-primary/85 touch:px-3.5 touch:py-2 touch:text-sm'>
                Done
              </button>
            </div>
            <input
              id='lyrics-custom-hue'
              type='range'
              min={0}
              max={359}
              step={1}
              value={customHue}
              onChange={(e) => {
                setCustomHue(Number(e.target.value))
              }}
              className='lyrics-hue-slider bg-hue-track'
            />
          </div>
        )}
      </section>

      <section className='flex flex-col gap-2'>
        <h3 className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
          Backdrop
        </h3>
        <div
          role='radiogroup'
          aria-label='Lyrics backdrop'
          className='grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1'>
          {LYRICS_BACKDROPS.map((option) => (
            <button
              key={option.id}
              type='button'
              role='radio'
              aria-checked={backdrop === option.id}
              onClick={() => {
                setBackdrop(option.id)
                close()
              }}
              className={cn(
                'rounded-md py-1.5 text-xs font-medium transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden touch:py-2.5 touch:text-sm',
                backdrop === option.id
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              {option.name}
            </button>
          ))}
        </div>
        <p className='text-xs text-muted-foreground'>{activeBackdrop?.hint}</p>
      </section>

      {source !== null && (
        <section className='flex items-center justify-between gap-3 border-t pt-3'>
          <p className='text-xs text-muted-foreground'>
            {SOURCE_NOTES[source]}
          </p>
          <button
            type='button'
            onClick={applyToAll}
            disabled={!ownStyle}
            className='-my-2 shrink-0 py-2 text-xs font-medium text-primary transition-colors hover:text-primary/80 disabled:pointer-events-none disabled:opacity-0 touch:text-sm'>
            Use For All Songs
          </button>
        </section>
      )}
    </div>
  )

  // On a touch screen the panel is a modal in the middle of the screen, opened only from its button. A
  // pick, Done, or a tap outside closes it
  if (touch) {
    return (
      <Dialog
        open={panel !== 'closed'}
        onOpenChange={(open) => {
          if (!open) {
            close()
          }
        }}>
        <RailButton
          label='Lyrics Style'
          className={cn(panel !== 'closed' && 'bg-white/10')}
          onClick={() => {
            setPanel(panel === 'closed' ? 'pinned' : 'closed')
          }}>
          <PaletteIcon className='size-5 shrink-0' />
        </RailButton>
        <DialogContent
          data-player-chrome
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
          }}
          variant='bare'
          className='max-w-sm'>
          {body}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Popover
      open={panel !== 'closed'}
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}>
      <PopoverAnchor virtualRef={anchorRef} />
      <RailTooltip label='Lyrics Style'>
        <PopoverTrigger asChild>
          <RailButton
            label='Lyrics Style'
            className={cn(panel !== 'closed' && 'bg-white/10')}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse') {
                peek.enter(true)
              }
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') {
                peek.leave(true)
              }
            }}
            onClick={(event) => {
              // A click pins a panel the hover only peeked open
              event.preventDefault()
              fromKeyboardRef.current = event.detail === 0
              setPanel(panel === 'pinned' ? 'closed' : 'pinned')
            }}>
            <PaletteIcon className='size-5 shrink-0' />
          </RailButton>
        </PopoverTrigger>
      </RailTooltip>

      <PopoverContent
        data-player-chrome
        side={portrait ? 'bottom' : 'right'}
        sideOffset={portrait ? 8 : 14}
        collisionPadding={8}
        // Follows the rail as it slides in, when a click on the lyrics opens both at once
        updatePositionStrategy='always'
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
        onInteractOutside={(event) => {
          // A click on the lyrics opens the panel, so pressing them is not a click outside
          if (
            event.target instanceof Element &&
            event.target.closest('[data-lyrics-style-toggle]') !== null
          ) {
            event.preventDefault()
          }
        }}
        onPointerEnter={() => {
          peek.enter(false)
        }}
        onPointerLeave={() => {
          peek.leave(false)
        }}
        variant='floating'
        className='z-300 max-h-(--radix-popover-content-available-height) w-[min(300px,calc(100vw-1rem))] overflow-y-auto'>
        {body}
      </PopoverContent>
    </Popover>
  )
}
