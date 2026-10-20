import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The theme's own sizes, shadows and transitions (src/globals.css), so they override the classes
// they replace instead of passing for colors or unknown classes
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'bg-image': [{ bg: ['stripes'] }],
      'mask-image': [{ mask: ['fade-y'] }],
      transition: [
        {
          transition: [
            'dashoffset',
            'grid-cols',
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
      'drop-shadow': ['stage'],
      radius: ['panel'],
      shadow: ['fab', 'panel', 'glow', 'glow-sm', 'rail', 'stage'],
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
      ],
      text: ['badge', 'caption', 'label', 'body', 'micro'],
    },
  },
})

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
