import { useAtomValue } from 'jotai'

import type { LineShow } from '@/components/offline/lyric-line-block'
import {
  lyricsCustomHueAtom,
  lyricsThemeIdAtom,
  translationIsEnglishAtom,
} from '@/context/atoms'
import { getLyricsThemeColors } from '@/lib/lyrics-themes'
import { readerPrefsAtom } from '@/lib/offline/reader-prefs'
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

// The reader bar's round button: 40px, 44px on touch screens, in the reader's own colours. `pressed` makes it a
// toggle, filled while on
export const READER_BUTTON =
  'flex size-10 shrink-0 items-center justify-center rounded-full text-(--reader-fg) transition-colors hover:bg-(--reader-hover) touch:size-11'

export const ReaderButton = ({
  label,
  pressed,
  onClick,
  children,
  className,
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) => (
  <button
    type='button'
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    onClick={onClick}
    className={cn(
      READER_BUTTON,
      pressed === true && 'bg-(--reader-hover)',
      className
    )}>
    {children}
  </button>
)
