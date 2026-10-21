import { useAtom } from 'jotai'
import { CheckIcon, PaletteIcon } from 'lucide-react'
import type { CSSProperties, RefObject } from 'react'
import { useId, useRef } from 'react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import {
  fontSizeMultiplierAtom,
  lyricsBackdropAtom,
  lyricsCustomHueAtom,
  lyricsStylePanelAtom,
  lyricsThemeIdAtom,
  lyricsTwoLinesAtom,
} from '@/context/atoms'
import { useMediaQuery, usePortrait } from '@/hooks/use-media-query'
import type { LyricsThemeColors } from '@/lib/lyrics-themes'
import {
  LYRICS_BACKDROPS,
  LYRICS_THEMES,
  getCustomThemeColors,
} from '@/lib/lyrics-themes'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import {
  LyricsStyleScopeSection,
  MyStyles,
  ScreenSizeTweak,
} from './lyrics-style-scope'
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
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- swatch buttons in an ARIA radio group; a native radio input is a different control
      role='radio'
      aria-checked={selected}
      aria-label={name}
      onClick={onSelect}
      className='group flex flex-col items-center gap-1 focus-visible:outline-hidden'>
      <span
        className={cn(
          'relative flex h-11 w-14 items-center justify-center overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-popover transition-all duration-150 bg-theme-swatch',
          selected
            ? 'ring-foreground'
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
          <span className='absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background'>
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

// The karaoke two-row layout, on or off. A switch, so it applies without closing the panel
const TwoLinesSwitch = ({ portrait }: { portrait: boolean }) => {
  const [twoLines, setTwoLines] = useAtom(lyricsTwoLinesAtom)
  const hintId = useId()
  return (
    <section className='flex flex-col gap-1'>
      <button
        type='button'
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a switch: on and off, applied at once
        role='switch'
        aria-checked={twoLines}
        aria-describedby={hintId}
        onClick={() => {
          setTwoLines(!twoLines)
        }}
        className='group -mx-2 flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-sm font-medium focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden touch:min-h-11'>
        Two Lines
        <span
          aria-hidden='true'
          className={cn(
            'relative h-5 w-9 shrink-0 rounded-full transition-colors',
            twoLines ? 'bg-primary' : 'bg-secondary ring-1 ring-border'
          )}>
          <span
            className={cn(
              'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
              twoLines && 'translate-x-4'
            )}
          />
        </span>
      </button>
      <p id={hintId} className='text-xs text-muted-foreground'>
        {portrait
          ? 'Shows the next line in a second row, on a wide screen or a phone turned sideways.'
          : 'Shows the next line in a second row, so you can read ahead.'}
      </p>
    </section>
  )
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

  const activeBackdrop = LYRICS_BACKDROPS.find((b) => b.id === backdrop)

  const heading = touch ? (
    <DialogTitle size='sm'>Lyrics Style</DialogTitle>
  ) : (
    <h2 className='text-sm font-semibold'>Lyrics Style</h2>
  )
  const body = (
    <div className='flex flex-col gap-4 p-4 unhighlightable'>
      <div className='flex items-center touch:pr-10'>{heading}</div>

      <LyricsStyleScopeSection />

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
        <ScreenSizeTweak />
      </section>

      <TwoLinesSwitch portrait={portrait} />

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
                className='rounded-full bg-primary-subtle px-2.5 py-1 text-xs font-semibold text-primary-text transition-colors hover:bg-primary-subtle-hover touch:px-3.5 touch:py-2 touch:text-sm'>
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
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- swatch buttons in an ARIA radio group; a native radio input is a different control
              role='radio'
              aria-checked={backdrop === option.id}
              onClick={() => {
                setBackdrop(option.id)
                close()
              }}
              className={cn(
                'rounded-sm py-1.5 text-xs font-medium transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden touch:py-2.5 touch:text-sm',
                backdrop === option.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              {option.name}
            </button>
          ))}
        </div>
        <p className='text-xs text-muted-foreground'>{activeBackdrop?.hint}</p>
      </section>

      <MyStyles onApplied={close} />
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
