// A black bar's pixels after JPEG compression: every channel stays under this
const DARK = 28
// Past this the bars are not a wide film's or a 4:3 picture's (an upright video, an all-black frame): leave it
export const MAX_ZOOM = 1.5
// Pixels taken past each bar's measured edge, where compression blends the bar into the picture
const EDGE = 1

type Pixels = Pick<ImageData, 'data' | 'width' | 'height'>

// Whether a line of pixels is all black: `count` pixels from pixel `from`, `step` apart (1 along a row, the
// picture's width down a column)
const darkLine = (
  data: Pixels['data'],
  from: number,
  step: number,
  count: number
) => {
  for (let index = 0; index < count; index += 1) {
    const at = (from + index * step) * 4
    if (Math.max(data[at], data[at + 1], data[at + 2]) >= DARK) {
      return false
    }
  }
  return true
}

// Black lines counted in from one edge, up to half the picture
const run = (size: number, dark: (at: number) => boolean, fromEnd: boolean) => {
  let count = 0
  while (count < size / 2 && dark(fromEnd ? size - 1 - count : count)) {
    count += 1
  }
  return count
}

// The scale that pushes one axis's bars out of the frame: the thinner of its two bars, since zooming about the
// centre removes the same amount from both sides. A bar on one side only is part of the picture
const axisZoom = (size: number, dark: (at: number) => boolean) => {
  const bar = Math.min(run(size, dark, false), run(size, dark, true))
  if (bar === 0) {
    return 1
  }
  const picture = size - 2 * (bar + EDGE)
  return picture > 0 ? size / picture : Infinity
}

/** How far a picture must be scaled about its centre for its black bars (above and below, or at the sides)
 *  to fall outside its frame; 1 when it has none, or when they are too thick to be bars */
export const coverZoom = ({ data, width, height }: Pixels): number => {
  const zoom = Math.max(
    axisZoom(height, (y) => darkLine(data, y * width, 1, width)),
    axisZoom(width, (x) => darkLine(data, x, width, height))
  )
  return zoom > MAX_ZOOM ? 1 : zoom
}

/** The scale for a song's YouTube picture, or null when it can't be loaded or read. YouTube's 320x180 picture
 *  is always 16:9, the cards' shape, and small enough to read every pixel of */
export const measureCover = async (videoId: string): Promise<number | null> => {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
  try {
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) {
      return null
    }
    context.drawImage(image, 0, 0)
    return coverZoom(context.getImageData(0, 0, canvas.width, canvas.height))
  } catch {
    return null
  }
}
