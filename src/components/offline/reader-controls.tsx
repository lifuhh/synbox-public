import { useAtom, useAtomValue } from 'jotai'
import {
  BoldIcon,
  CheckIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
} from 'lucide-react'
import { useState } from 'react'

import type { LineShow } from '@/components/offline/lyric-line-block'
import {
  lyricsCustomHueAtom,
  lyricsThemeIdAtom,
  translationIsEnglishAtom,
} from '@/context/atoms'
import { getLyricsThemeColors } from '@/lib/lyrics-themes'
import type { ReaderLayer } from '@/lib/offline/reader-prefs'
import {
  READER_COLORS,
  READER_SIZES,
  readerColor,
  readerPrefsAtom,
} from '@/lib/offline/reader-prefs'
import type { CssVars } from '@/types'
import { cn } from '@/utils/cn'

// The Lyrics Style colour, which Text Style's Video colour follows
export const useVideoColor = () =>
  getLyricsThemeColors(
    useAtomValue(lyricsThemeIdAtom),
    useAtomValue(lyricsCustomHueAtom)
  ).accent

// The lines a page of lyrics shows (Text Style's own), in the translation language the video uses too
export const useTextLines = (): LineShow => {
  const prefs = useAtomValue(readerPrefsAtom)
  const english = useAtomValue(translationIsEnglishAtom)
  return {
    bold: prefs.bold,
    japanese: prefs.japanese,
    language: english ? 'en' : 'zh',
    romaji: prefs.romaji,
    translation: prefs.translation,
  }
}

// A 40px target, 44px on touch screens, with the reader's own colours
export const ReaderButton = ({
  label,
  pressed,
  disabled,
  onClick,
  children,
  className,
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) => (
  <button
    type='button'
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'flex size-10 shrink-0 items-center justify-center rounded-full text-(--reader-fg) transition-colors hover:bg-(--reader-hover) disabled:opacity-35 disabled:hover:bg-transparent touch:size-11',
      pressed === true && 'bg-(--reader-hover)',
      className
    )}>
    {children}
  </button>
)

const LAYERS: { id: ReaderLayer; label: string }[] = [
  { id: 'japanese', label: 'Japanese' },
  { id: 'romaji', label: 'Romaji' },
  { id: 'translation', label: 'Translation' },
]

// Which lines each block shows. One always stays on, so the page is never blank
export const LayersPanel = () => {
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  const [english, setEnglish] = useAtom(translationIsEnglishAtom)
  const language = english ? 'en' : 'zh'
  const shown = LAYERS.filter((layer) => prefs[layer.id]).length
  return (
    // Its corners hold the rows': their 8px plus the 6px padding and the border
    <div className='flex w-60 flex-col gap-0.5 rounded-2xl border border-(--reader-line) bg-(--reader-panel) p-1.5 shadow-xl'>
      {LAYERS.map((layer) => {
        const on = prefs[layer.id]
        return (
          <button
            key={layer.id}
            type='button'
            role='switch'
            aria-checked={on}
            disabled={on && shown === 1}
            onClick={() => {
              setPrefs({ [layer.id]: !on })
            }}
            className='flex h-11 items-center justify-between rounded-lg px-3 text-label text-(--reader-fg) transition-colors hover:bg-(--reader-hover) disabled:opacity-60'>
            {layer.label}
            <span
              aria-hidden='true'
              className={cn(
                'flex h-5 w-9 items-center rounded-full p-0.5 transition-colors',
                on ? 'bg-(--reader-fg)' : 'bg-(--reader-line-strong)'
              )}>
              <span
                className={cn(
                  'size-4 rounded-full bg-(--reader-bg) transition-transform motion-reduce:transition-none',
                  on && 'translate-x-4'
                )}
              />
            </span>
          </button>
        )
      })}
      <fieldset
        aria-label='Translation Language'
        className={cn(
          'mx-1.5 mt-1 mb-1 grid grid-cols-2 rounded-lg bg-(--reader-hover) p-0.5',
          !prefs.translation && 'opacity-50'
        )}>
        {(
          [
            ['en', 'English'],
            ['zh', '中文'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type='button'
            aria-pressed={language === id}
            onClick={() => {
              setEnglish(id === 'en')
              setPrefs({ translation: true })
            }}
            className={cn(
              'h-9 rounded-md text-sm font-medium text-(--reader-fg) transition-colors',
              language === id && 'bg-(--reader-bg) shadow-sm'
            )}>
            {label}
          </button>
        ))}
      </fieldset>
    </div>
  )
}

const SELECTED_RING =
  'ring-2 ring-(--reader-fg) ring-offset-2 ring-offset-(--reader-bg)'

// The swatches have no labels, so Video (the Lyrics Style colour) carries a play mark: it can be the same colour as
// another swatch
const ColorSwatch = ({
  label,
  color,
  video,
  selected,
  onSelect,
}: {
  label: string
  color: string
  video: boolean
  selected: boolean
  onSelect: () => void
}) => {
  const swatchVars: CssVars = { '--swatch': color }
  return (
    <button
      type='button'
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className='flex size-9 shrink-0 items-center justify-center rounded-full'>
      <span
        style={swatchVars}
        className={cn(
          'flex size-6 items-center justify-center rounded-full border border-(--reader-line-strong) bg-(--swatch)',
          selected && SELECTED_RING
        )}>
        {video && (
          <PlayIcon
            aria-hidden
            className='size-2.5 translate-x-px fill-(--reader-bg) text-(--reader-bg)'
          />
        )}
      </span>
    </button>
  )
}

const Divider = () => (
  <span aria-hidden='true' className='h-6 w-px shrink-0 bg-(--reader-line)' />
)

// Text size, bold and the Japanese line's colour, in one row. The custom colour's hue slider takes the
// swatches' place in that row while it is open
export const TypeBar = () => {
  const [prefs, setPrefs] = useAtom(readerPrefsAtom)
  const video = useVideoColor()
  const [customOpen, setCustomOpen] = useState(false)
  return (
    <div className='mx-auto flex h-14 w-full max-w-lg items-center gap-1.5 px-2 sm:gap-2.5 sm:px-3'>
      <ReaderButton
        label='Smaller Text'
        disabled={prefs.size === 0}
        onClick={() => {
          setPrefs({ size: Math.max(prefs.size - 1, 0) })
        }}>
        <MinusIcon className='size-4' />
        <span aria-hidden='true' className='text-xs font-semibold'>
          A
        </span>
      </ReaderButton>
      <ReaderButton
        label='Larger Text'
        disabled={prefs.size === READER_SIZES.length - 1}
        onClick={() => {
          setPrefs({ size: Math.min(prefs.size + 1, READER_SIZES.length - 1) })
        }}>
        <PlusIcon className='size-4' />
        <span aria-hidden='true' className='text-base font-semibold'>
          A
        </span>
      </ReaderButton>
      <Divider />
      <ReaderButton
        label='Bold Text'
        pressed={prefs.bold}
        onClick={() => {
          setPrefs({ bold: !prefs.bold })
        }}>
        <BoldIcon className='size-5' />
      </ReaderButton>
      <Divider />
      {customOpen ? (
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <input
            type='range'
            aria-label='Custom Colour'
            min={0}
            max={359}
            step={1}
            value={prefs.hue}
            onChange={(event) => {
              setPrefs({ color: 'custom', hue: Number(event.target.value) })
            }}
            className='lyrics-hue-slider min-w-0 flex-1 bg-hue-track'
          />
          <ReaderButton
            label='Done'
            onClick={() => {
              setCustomOpen(false)
            }}>
            <CheckIcon className='size-5' />
          </ReaderButton>
        </div>
      ) : (
        <fieldset
          aria-label='Japanese Colour'
          className='no-scrollbar flex min-w-0 flex-1 items-center justify-between gap-0.5 overflow-x-auto'>
          {READER_COLORS.map((color) => (
            <ColorSwatch
              key={color.id}
              label={color.label}
              video={color.id === 'video'}
              selected={prefs.color === color.id}
              color={
                readerColor({
                  id: color.id,
                  prefs,
                  theme: prefs.theme,
                  video,
                }) ?? 'var(--reader-fg)'
              }
              onSelect={() => {
                setPrefs({ color: color.id })
              }}
            />
          ))}
          <button
            type='button'
            aria-pressed={prefs.color === 'custom'}
            aria-label='Custom Colour'
            title='Custom Colour'
            onClick={() => {
              setPrefs({ color: 'custom' })
              setCustomOpen(true)
            }}
            className='flex size-9 shrink-0 items-center justify-center rounded-full'>
            <span
              className={cn(
                'size-6 rounded-full border border-(--reader-line-strong) bg-hue-wheel',
                prefs.color === 'custom' && SELECTED_RING
              )}
            />
          </button>
        </fieldset>
      )}
    </div>
  )
}
