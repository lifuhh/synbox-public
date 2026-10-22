import { atom, useAtomValue, useSetAtom } from 'jotai'

import { useMediaQuery } from '@/hooks/use-media-query'

// On a phone held upright the watch page shows the player's own karaoke lines under the video, the line being
// sung alone and filling as it is sung, where a wider page has the scrolling lyrics panel. The stage's lyrics
// render into this band through a portal: the player-page's renderLyrics finds it here
const bandAtom = atom<HTMLElement | null>(null)

export const useKaraokeBand = () => useAtomValue(bandAtom)

export const usePhoneUpright = () =>
  useMediaQuery('(pointer: coarse) and (orientation: portrait)')

export const KaraokeBand = () => {
  const setBand = useSetAtom(bandAtom)
  return (
    <div
      ref={setBand}
      data-karaoke-band
      className='watch-karaoke-band relative mx-4 mt-2 shrink-0 overflow-hidden rounded-2xl bg-card'
    />
  )
}
