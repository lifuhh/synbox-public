import { useAtomValue, useSetAtom } from 'jotai'
import { XIcon } from 'lucide-react'

import {
  dismissSharedLyricsStyleAtom,
  keepSharedLyricsStyleAtom,
  lyricsStyleAtom,
  lyricsStyleSourceAtom,
} from '@/context/atoms'
import { getLyricsThemeColors } from '@/lib/lyrics-themes'
import type { CssVars } from '@/types'

// Shown while the lyrics wear the style a link was shared with. It applies for this visit only; Keep saves
// it as this song's style, the cross puts the viewer's own back
const SharedStyleBanner = () => {
  const source = useAtomValue(lyricsStyleSourceAtom)
  const style = useAtomValue(lyricsStyleAtom)
  const keep = useSetAtom(keepSharedLyricsStyleAtom)
  const dismiss = useSetAtom(dismissSharedLyricsStyleAtom)

  if (source !== 'shared') {
    return null
  }

  const swatchVars: CssVars = {
    '--banner-swatch': getLyricsThemeColors(style.themeId, style.customHue)
      .accent,
  }
  return (
    <output
      data-preview-banner
      className='fixed top-[calc(var(--topbar-h)+0.5rem+var(--notices-h,0px))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 py-1 pr-1 pl-3.5 text-sm whitespace-nowrap text-white shadow-lg ring-1 ring-white/20 backdrop-blur-md'>
      <span
        aria-hidden='true'
        className='size-3 shrink-0 rounded-full bg-(--banner-swatch) ring-1 ring-white/40'
        style={swatchVars}
      />
      <span className='ml-1 font-medium'>Shared Style</span>
      <button
        type='button'
        onClick={keep}
        className='ml-2 rounded-full bg-primary px-3 py-1 font-medium transition-colors hover:bg-primary/85'>
        Keep
      </button>
      <button
        type='button'
        aria-label='Use My Style'
        title='Use My Style'
        onClick={dismiss}
        className='rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white'>
        <XIcon className='size-4 shrink-0' />
      </button>
    </output>
  )
}

export default SharedStyleBanner
