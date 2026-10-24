import { useAtom, useAtomValue } from 'jotai'
import { CheckIcon, PaletteIcon } from 'lucide-react'
import type { CSSProperties, RefObject } from 'react'
import { use, useId, useRef } from 'react'

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
  lyricsCustomHueAtom,
  lyricsFontSizeTwoLinesAtom,
  lyricsStylePanelAtom,
  lyricsThemeIdAtom,
  lyricsTranslationDockedAtom,
  lyricsTwoLinesAtom,
  playerSurfaceAtom,
} from '@/context/atoms'
import {
  useLyricsSurface,
  useMediaQuery,
  usePortrait,
} from '@/hooks/use-media-query'
import { sizeRangeOn } from '@/lib/lyrics-style'
import type { LyricsThemeColors } from '@/lib/lyrics-themes'
import { LYRICS_THEMES, getCustomThemeColors } from '@/lib/lyrics-themes'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

import {
  LyricsStyleScopeSection,
  MyStyles,
  SaveStyle,
} from './lyrics-style-scope'
import { RailButton, RailInline, railMenuSide } from './rail-button'

const HALF_FILLED: CSSProperties & Record<'--p', number> = { '--p': 0.5 }

// A hint on its label's line ("Two Lines · Landscape only"): quieter than the label, after a centred dot.
// The dot takes its label's size, raised a little so it centres on the capitals as well as the x-height
const INLINE_HINT = 'text-xs font-normal text-faint'
const InlineHintDot = () => (
  <span
    aria-hidden='true'
    className='relative -top-[0.075em] px-1.5 font-normal text-faint'>
    ·
  </span>
)

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
          'relative flex h-11 w-14 items-center justify-center overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-popover transition-shadow duration-150 bg-theme-swatch',
          // Focus turns even the chosen swatch's ring to the focus colour
          selected
            ? 'ring-foreground group-focus-visible:ring-ring'
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

// A switch row in the panel: on and off, applied at once without closing it. A hint, when the label alone
// doesn't say it, sits on the label's line after a dot
const StyleSwitch = ({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) => {
  const labelId = useId()
  const hintId = useId()
  return (
    <button
      type='button'
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a switch: on and off, applied at once
      role='switch'
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={hint === undefined ? undefined : hintId}
      onClick={() => {
        onChange(!checked)
      }}
      className='group -mx-2 flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-sm font-medium focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden touch:min-h-11'>
      <span className='flex min-w-0 items-baseline'>
        <span id={labelId}>{label}</span>
        {hint !== undefined && (
          <>
            <InlineHintDot />
            <span id={hintId} className={INLINE_HINT}>
              {hint}
            </span>
          </>
        )}
      </span>
      <span
        aria-hidden='true'
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-secondary ring-1 ring-border'
        )}>
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
            checked && 'translate-x-4'
          )}
        />
      </span>
    </button>
  )
}

// A discrete pick (a preset colour) applies and closes, like a menu. Size and the custom hue
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
  const inline = use(RailInline)
  const touch = useMediaQuery('(pointer: coarse)')
  // Focus moves in, and back to the button on close, only for a panel opened from the keyboard; after a
  // hover or a click it would pop the button's tooltip and hold the player's UI open
  const fromKeyboardRef = useRef(false)
  const close = () => {
    setPanel('closed')
  }
  const [fontSize, setFontSize] = useAtom(fontSizeMultiplierAtom)
  const [fontSizeTwoLines, setFontSizeTwoLines] = useAtom(
    lyricsFontSizeTwoLinesAtom
  )
  const [twoLines, setTwoLines] = useAtom(lyricsTwoLinesAtom)
  const [docked, setDocked] = useAtom(lyricsTranslationDockedAtom)
  // The slider sizes the layout on screen: two lines keep their own size; each screen allows its own range. An
  // upright phone's watch page has no slider: its lyrics under the video keep one size
  const surface = useLyricsSurface()
  const playerSurface = useAtomValue(playerSurfaceAtom)
  const sized = surface !== 'portrait' || playerSurface === 'stage'
  const sizedTwoLines = twoLines && !portrait
  const size = {
    range: sizeRangeOn(surface, sizedTwoLines),
    set: sizedTwoLines ? setFontSizeTwoLines : setFontSize,
    value: sizedTwoLines ? fontSizeTwoLines : fontSize,
  }
  const [themeId, setThemeId] = useAtom(lyricsThemeIdAtom)
  const [customHue, setCustomHue] = useAtom(lyricsCustomHueAtom)

  const heading = touch ? (
    <DialogTitle size='sm'>Lyrics Style</DialogTitle>
  ) : (
    <h2 className='text-sm font-semibold'>Lyrics Style</h2>
  )
  const body = (
    <div className='flex flex-col gap-4 p-4 unhighlightable'>
      <div className='flex items-center touch:pr-10'>{heading}</div>

      <LyricsStyleScopeSection />

      {/* The layout switches sit a section's inner gap under the size row, not a full section gap: their 40px
          press targets already pad them */}
      <div className='flex flex-col gap-2'>
        {sized && (
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
                min={size.range.min}
                max={size.range.max}
                step={0.01}
                // A size saved on a screen with more room shows at this screen's end
                value={[
                  Math.min(
                    size.range.max,
                    Math.max(size.range.min, size.value)
                  ),
                ]}
                onValueChange={([value]) => {
                  if (value !== undefined) {
                    size.set(value)
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

        {/* The karaoke machine's two rows: top row left, next row right, the translation at the top */}
        <StyleSwitch
          label='Karaoke Style'
          checked={twoLines}
          onChange={setTwoLines}
          hint={portrait ? 'Landscape only' : undefined}
        />
        {/* The same as pulling the translation down onto the rows, or up off them */}
        {twoLines && !portrait && (
          <StyleSwitch
            label='Translation Under Lyrics'
            checked={docked}
            onChange={setDocked}
          />
        )}
      </div>

      <section className='flex flex-col gap-2'>
        <h3 className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
          Colour
        </h3>
        <div
          role='radiogroup'
          aria-label='Lyrics Colour'
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
          <div className='mt-1 flex items-center gap-3'>
            <input
              type='range'
              aria-label='Hue'
              min={0}
              max={359}
              step={1}
              value={customHue}
              onChange={(e) => {
                setCustomHue(Number(e.target.value))
              }}
              className='lyrics-hue-slider min-w-0 flex-1 bg-hue-track'
            />
            <button
              type='button'
              onClick={() => {
                close()
              }}
              className='shrink-0 rounded-full bg-primary-subtle px-2.5 py-1 text-xs font-semibold text-primary-text transition-colors hover:bg-primary-subtle-hover touch:px-3.5 touch:py-2 touch:text-sm'>
              Done
            </button>
          </div>
        )}
      </section>

      <MyStyles onApplied={close} />

      <SaveStyle />
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
          className='max-w-sm scroll-pb-20'>
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

      <PopoverContent
        data-player-chrome
        side={railMenuSide(inline, portrait)}
        sideOffset={portrait || inline ? 8 : 14}
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
        aria-label='Lyrics Style'
        variant='floating'
        className='z-300 max-h-(--radix-popover-content-available-height) w-[min(300px,calc(100vw-1rem))] scroll-pb-20 overflow-y-auto overscroll-contain'>
        {body}
      </PopoverContent>
    </Popover>
  )
}
