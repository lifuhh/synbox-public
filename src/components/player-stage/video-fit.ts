import { useQuery } from '@tanstack/react-query'
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useSyncExternalStore } from 'react'

export const WIDE_ASPECT = 16 / 9

// 'fit' shows the whole picture; 'zoom' fills the stage and crops what overflows
export type VideoFit = 'fit' | 'zoom'
// A phone held upright, a phone on its side (the `short:` variant), and everything else
export type StageScreen = 'portrait' | 'landscape' | 'wide'

// A phone on its side is wider than any music video, so it fills by default: the crop is a strip off the
// top and bottom. Upright, filling would cut away three quarters of the picture
const DEFAULT_FIT: Record<StageScreen, VideoFit> = {
  landscape: 'zoom',
  portrait: 'fit',
  wide: 'fit',
}

const videoFitAtom = atomWithStorage<Partial<Record<StageScreen, VideoFit>>>(
  'playerVideoFit',
  {}
)

const SCREEN_QUERIES = {
  landscape: '(orientation: landscape) and (max-height: 500px)',
  portrait: '(pointer: coarse) and (orientation: portrait)',
} as const

const readScreen = (): StageScreen => {
  if (matchMedia(SCREEN_QUERIES.landscape).matches) {
    return 'landscape'
  }
  return matchMedia(SCREEN_QUERIES.portrait).matches ? 'portrait' : 'wide'
}

const subscribeScreen = (onChange: () => void) => {
  const lists = Object.values(SCREEN_QUERIES).map((query) => matchMedia(query))
  for (const list of lists) {
    list.addEventListener('change', onChange)
  }
  return () => {
    for (const list of lists) {
      list.removeEventListener('change', onChange)
    }
  }
}

// The fit chosen for this kind of screen, remembered per kind: turning the phone picks up its own choice
export const useVideoFit = () => {
  const screen = useSyncExternalStore(subscribeScreen, readScreen)
  const [chosen, setChosen] = useAtom(videoFitAtom)
  const fit = chosen[screen] ?? DEFAULT_FIT[screen]
  const toggleFit = () => {
    setChosen({ ...chosen, [screen]: fit === 'zoom' ? 'fit' : 'zoom' })
  }
  return { fit, toggleFit }
}

// oEmbed sizes its embed to the video's own shape: 1280x720 for 16:9, 1280x960 for 4:3, 720x1280 upright
const fetchAspect = async (videoId: string) => {
  const params = new URLSearchParams({
    format: 'json',
    maxheight: '1280',
    maxwidth: '1280',
    url: `https://www.youtube.com/watch?v=${videoId}`,
  })
  const response = await fetch(`https://www.youtube.com/oembed?${params}`)
  if (!response.ok) {
    throw new Error(`oEmbed answered ${response.status}`)
  }
  const body: unknown = await response.json()
  const { width, height } =
    typeof body === 'object' && body !== null
      ? (body as { width?: unknown; height?: unknown })
      : {}
  return typeof width === 'number' &&
    typeof height === 'number' &&
    width > 0 &&
    height > 0
    ? width / height
    : WIDE_ASPECT
}

// The video's width over its height; 16:9 until YouTube says otherwise, and anything within rounding of it
export const useVideoAspect = (videoId: string) => {
  const { data = WIDE_ASPECT } = useQuery({
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: async () => await fetchAspect(videoId),
    queryKey: ['video-aspect', videoId],
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return Math.abs(data - WIDE_ASPECT) < 0.02 ? WIDE_ASPECT : data
}
