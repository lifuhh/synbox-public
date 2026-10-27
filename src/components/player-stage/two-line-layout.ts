import { pageBox } from '@/lib/page-turn'

// A row's drawn text (its Japanese, its romaji) in a line's box: across from the box's left edge, and up from a
// floor, so a taller line grows to larger `top`
export interface TextSpan {
  left: number
  right: number
  bottom: number
  top: number
}

// Where Two Lines' upper line (the left one) stands, as its floor's height over the lower line's floor: its home, a
// one-row pair and the rows' gap above, or as much higher as the lower line's text reaches into its own. Only text
// that shares some of the width can meet, so a short lower line rising beside the upper line's romaji moves nothing
export const upperLineFloor = ({
  home,
  gap,
  lower,
  upper,
}: {
  home: number
  gap: number
  // The lower line's rows, up from its floor
  lower: TextSpan[]
  // The upper line's rows, up from the upper line's own floor
  upper: TextSpan[]
}) => {
  let floor = home
  for (const below of lower) {
    for (const above of upper) {
      if (above.left < below.right && below.left < above.right) {
        floor = Math.max(floor, below.top + gap - above.bottom)
      }
    }
  }
  return floor
}

// The drawn text of each of a line's rows, in the page's axes (a page turned by Lock Landscape too), from `box`'s
// left edge and up from its floor
export const textSpansOf = (line: HTMLElement, box: HTMLElement) => {
  const frame = pageBox(box.getBoundingClientRect())
  const range = document.createRange()
  // Each child is one of the line's rows: its Japanese, its romaji
  return [...line.children].flatMap((row) => {
    range.selectNodeContents(row)
    const rects = [...range.getClientRects()]
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => pageBox(rect))
    if (rects.length === 0) {
      return []
    }
    return [
      {
        bottom: frame.bottom - Math.max(...rects.map((rect) => rect.bottom)),
        left: Math.min(...rects.map((rect) => rect.left)) - frame.left,
        right: Math.max(...rects.map((rect) => rect.right)) - frame.left,
        top: frame.bottom - Math.min(...rects.map((rect) => rect.top)),
      },
    ]
  })
}

export interface Span {
  top: number
  bottom: number
}

// Where a box `height` tall, asked to stand at `top`, may go so it stays out of `block` by `gap` and inside `room`
// (its top's span): where asked when that is clear, else just past the block on the nearer side that has room for it,
// else null (there is nowhere outside the block for it). In layout units within the lyrics' layer
export const outsideOf = (
  top: number,
  height: number,
  block: Span,
  room: Span,
  gap: number
): number | null => {
  const inRoom = (at: number) => at >= room.top - 0.5 && at <= room.bottom + 0.5
  const asked = Math.min(room.bottom, Math.max(room.top, top))
  if (asked >= block.bottom + gap || asked + height <= block.top - gap) {
    return asked
  }
  const above = block.top - gap - height
  const below = block.bottom + gap
  if (!inRoom(above)) {
    return inRoom(below) ? below : null
  }
  if (!inRoom(below)) {
    return above
  }
  return Math.abs(above - top) <= Math.abs(below - top) ? above : below
}

// Whether a box asked to stand at `top` is over the block: its centre inside it, where letting go docks
export const overBlock = (top: number, height: number, block: Span) => {
  const centre = top + height / 2
  return centre >= block.top && centre <= block.bottom
}
