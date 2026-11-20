import { describe, expect, it } from 'vite-plus/test'

import { coverZoom } from './use-cover-zoom'

const WIDTH = 320
const HEIGHT = 180

// A grey picture with black bars of the given thickness on each side
const picture = (bars: {
  top?: number
  bottom?: number
  left?: number
  right?: number
}) => {
  const { top = 0, bottom = 0, left = 0, right = 0 } = bars
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const bar =
        y < top || y >= HEIGHT - bottom || x < left || x >= WIDTH - right
      // Compression leaves a bar slightly off black
      data.fill(bar ? 6 : 128, (y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 3)
    }
  }
  return { data, height: HEIGHT, width: WIDTH }
}

describe('coverZoom', () => {
  it('leaves a picture with no bars alone', () => {
    expect(coverZoom(picture({}))).toBe(1)
  })

  it('zooms a wide film until its bars leave the frame', () => {
    // 2.35:1 in 16:9: 22px above and below
    const zoom = coverZoom(picture({ bottom: 22, top: 22 }))
    expect((HEIGHT - 2 * 22) * zoom).toBeGreaterThanOrEqual(HEIGHT)
    expect(zoom).toBeLessThan(1.4)
  })

  it('zooms a 4:3 picture past its side bars', () => {
    const zoom = coverZoom(picture({ left: 40, right: 40 }))
    expect((WIDTH - 2 * 40) * zoom).toBeGreaterThanOrEqual(WIDTH)
  })

  it('goes by the thinner bar when they differ', () => {
    expect(coverZoom(picture({ bottom: 10, top: 30 }))).toBe(
      coverZoom(picture({ bottom: 10, top: 10 }))
    )
  })

  it('takes a dark edge on one side only for part of the picture', () => {
    expect(coverZoom(picture({ top: 40 }))).toBe(1)
  })

  it('leaves an upright video and an all-black frame alone', () => {
    expect(coverZoom(picture({ left: 110, right: 110 }))).toBe(1)
    expect(coverZoom(picture({ bottom: 90, top: 90 }))).toBe(1)
  })
})
