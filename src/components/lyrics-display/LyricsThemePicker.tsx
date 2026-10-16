import { useAtom, useAtomValue } from 'jotai'
import { CheckIcon, PaletteIcon } from 'lucide-react'
import { useState } from 'react'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  lyricsBackdropAtom,
  lyricsCustomHueAtom,
  lyricsDisplayBottomAtom,
  lyricsThemeIdAtom,
} from '@/context/atoms'
import type { LyricsThemeColors } from '@/lib/lyricsThemes'
import {
  DEFAULT_LYRICS_BACKDROP,
  DEFAULT_LYRICS_THEME_ID,
  LYRICS_BACKDROPS,
  LYRICS_THEMES,
  getCustomThemeColors,
  getLyricsThemeCssVars,
} from '@/lib/lyricsThemes'
import { cn } from '@/utils/cn'

const HUE_TRACK = `linear-gradient(to right, ${Array.from(
  { length: 13 },
  (_, i) => `oklch(0.7 0.15 ${i * 30})`
).join(', ')})`

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
}: ThemeSwatchProps) => (
  <button
    type='button'
    role='radio'
    aria-checked={selected}
    aria-label={name}
    onClick={onSelect}
    className='group flex flex-col items-center gap-1 focus-visible:outline-hidden'>
    <span
      className={cn(
        'relative flex h-11 w-14 items-center justify-center overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-popover transition-all duration-150',
        selected
          ? 'ring-primary'
          : 'ring-transparent group-hover:ring-border group-focus-visible:ring-ring'
      )}
      style={{
        background: 'linear-gradient(135deg, #ebe7e1 50%, #1c1820 50%)',
        ...getLyricsThemeCssVars(colors),
      }}>
      <span className='lyric-text-line font_noto_sans_jp_black_900 text-2xl leading-none'>
        あ
      </span>
      {selected && (
        <span className='absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white'>
          <CheckIcon className='size-3 shrink-0' />
        </span>
      )}
    </span>
    <span
      className={cn(
        'text-[11px] leading-none',
        selected ? 'text-foreground' : 'text-muted-foreground'
      )}>
      {name}
    </span>
  </button>
)

export const LyricsThemePicker = () => {
  const [opened, setOpened] = useState(false)
  const [themeId, setThemeId] = useAtom(lyricsThemeIdAtom)
  const [customHue, setCustomHue] = useAtom(lyricsCustomHueAtom)
  const [backdrop, setBackdrop] = useAtom(lyricsBackdropAtom)
  const isLyricsDisplayBottom = useAtomValue(lyricsDisplayBottomAtom)

  const isDefault =
    themeId === DEFAULT_LYRICS_THEME_ID && backdrop === DEFAULT_LYRICS_BACKDROP

  const handleReset = () => {
    setThemeId(DEFAULT_LYRICS_THEME_ID)
    setBackdrop(DEFAULT_LYRICS_BACKDROP)
  }

  const activeBackdrop = LYRICS_BACKDROPS.find((b) => b.id === backdrop)

  return (
    <Popover open={opened} onOpenChange={setOpened} modal>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <PopoverTrigger asChild>
              <button
                type='button'
                aria-label='Lyrics Style'
                className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white invisible-ring transition-transform duration-150 hover:scale-110'>
                <PaletteIcon className='size-[22px] shrink-0' />
              </button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        {!opened && (
          <TooltipContent
            side='right'
            sideOffset={6}
            className='border-none bg-primary unhighlightable'>
            Lyrics Style
          </TooltipContent>
        )}
      </Tooltip>

      <PopoverContent
        side='right'
        // Grow away from the lyrics so changes stay visible while picking
        align={isLyricsDisplayBottom ? 'end' : 'start'}
        sideOffset={14}
        className='z-300 w-[300px] rounded-[10px] p-0 shadow-[0_12px_32px_rgb(0_0_0/0.5)]'>
        <div className='flex flex-col gap-4 p-4 unhighlightable'>
          <div className='flex items-center justify-between'>
            <h2 className='text-sm font-semibold'>Lyrics Style</h2>
            <button
              type='button'
              onClick={handleReset}
              disabled={isDefault}
              className='text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0'>
              Reset
            </button>
          </div>

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
              <label className='mt-1 flex flex-col gap-2'>
                <span className='text-xs text-muted-foreground'>Hue</span>
                <input
                  type='range'
                  min={0}
                  max={359}
                  step={1}
                  value={customHue}
                  onChange={(e) => {
                    setCustomHue(Number(e.target.value))
                  }}
                  className='lyrics-hue-slider'
                  style={{ background: HUE_TRACK }}
                />
              </label>
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
                  }}
                  className={cn(
                    'rounded-md py-1.5 text-xs font-medium transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden',
                    backdrop === option.id
                      ? 'bg-primary text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  )}>
                  {option.name}
                </button>
              ))}
            </div>
            <p className='text-xs text-muted-foreground'>
              {activeBackdrop?.hint}
            </p>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  )
}
