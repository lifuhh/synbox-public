import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The theme's own sizes, shadows and transitions (src/globals.css), so they override the classes
// they replace instead of passing for colors or unknown classes
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'bg-image': [
        { bg: ['stripes', 'theme-swatch', 'hue-track', 'hue-wheel'] },
      ],
      'mask-image': [{ mask: ['fade-y'] }],
      transition: [
        {
          transition: [
            'dashoffset',
            'clip',
            'width',
            'translate-fade',
            'fade-translate',
            'filter-fade',
            'surface',
          ],
        },
      ],
    },
    theme: {
      // tw-animate-css's exit and the theme's own, so a popover variant's exit replaces the base one
      animate: ['out', 'into-trigger'],
      'drop-shadow': ['stage'],
      radius: ['panel'],
      shadow: ['panel', 'glow', 'glow-sm', 'rail', 'stage'],
      spacing: [
        'safe-top',
        'page-top',
        'page-bottom-sm',
        'page-bottom',
        'page-bottom-lg',
        'controls-bottom',
        'controls-left',
        'controls-right',
        'controls-rail',
        'cqw',
        'cqh',
        'reader-top',
        'reader-bottom',
        'reader-bottom-bar',
        'reader-follow',
        'reader-line',
        'reader-stanza',
      ],
      text: [
        'badge',
        'caption',
        'label',
        'body',
        'micro',
        'lyric',
        'lyric-secondary',
        'reader-title',
        'reader-ja',
        'reader-romaji',
        'reader-translation',
      ],
    },
  },
})

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
