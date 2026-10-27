import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useLocation } from 'react-router'

import { homeSearchFieldAtom } from '@/context/atoms'
import { reducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/utils/cn'

// Home has its own search field. Once it scrolls under the top bar it flies up into the bar and becomes the bar's
// search (the field on a wide screen, the button on a phone); scrolled back, it flies home.
//
// The ghost is one box that leaves from where it is (frozen as the flight starts) for the live box it lands on (the
// bar's search, or the field wherever the scroll has taken it), every edge on one progress, so the box never leans.
// Everything inside keeps to the edge it belongs to: the text to the left edge, sliding from the field's inset to
// the bar's at its own size; the bar's search icon at the bar's inset from the left edge, fading in; the field's
// action pill at the right end, shrinking with the box and fading in place. Scrolled back, the same frames reverse

// One timed ease-out: it starts at full speed and stops dead on its target, with no overshoot and no tail creeping
// the last pixels in (a spring's settle read as a bounce)
const FLIGHT_MS = 260
const easeOut = (x: number) => 1 - (1 - x) * (1 - x)
// How far below the bar the page's field must come back before the search leaves the bar, so a scroll resting
// at the edge doesn't send it back and forth
const RETURN_PX = 16

// How long after the page settles, or the search lands home, the bar's search is mounted out of sight
const MOUNT_AFTER_MS = 300

// Where the search is: home's field (`ready` once the bar's search is mounted, hidden, for the next flight), in
// flight, or in the bar
export type DockStage = 'page' | 'ready' | 'flying' | 'bar'

const mix = (from: number, to: number, t: number) => from + (to - from) * t
const ramp = (t: number, start: number, end: number) => {
  const x = Math.min(Math.max((t - start) / (end - start), 0), 1)
  return x * x * (3 - 2 * x)
}

// What a field draws as its own edge and fill, which the ghost blends between
const paintOf = (shell: HTMLElement) => {
  const style = getComputedStyle(shell)
  return {
    edge: style.borderTopWidth === '0px' ? 'transparent' : style.borderTopColor,
    fill: style.backgroundColor,
  }
}

// A computed length (always in px) as a number
const px = (value: string) => Number(value.replace('px', ''))

const drawn = (el: Element) => el.getClientRects().length > 0

type Part = HTMLElement | SVGElement

// A still copy of an element: no ids or hooks, and nothing in it transitions or animates, so each frame shows exactly
// where it was put (a copy of a button kept the button's 150ms transition and trailed every move it was given). Put
// at the ghost's corner, moved only by transform, on its own layer
const still = (el: Part, w: number, h: number): Part => {
  const copy = el.cloneNode(true)
  if (!(copy instanceof HTMLElement || copy instanceof SVGElement)) {
    throw new TypeError('A copy of an element is an element')
  }
  for (const node of [copy, ...copy.querySelectorAll<Part>('*')]) {
    for (const name of [
      'id',
      'data-bench',
      'data-dock-shell',
      'data-dock-face',
    ]) {
      node.removeAttribute(name)
    }
    node.style.transition = 'none'
    node.style.animation = 'none'
  }
  Object.assign(copy.style, {
    // Its own colour, which it inherited where it was (an icon in a button)
    color: getComputedStyle(el).color,
    height: `${h}px`,
    left: '0',
    margin: '0',
    position: 'absolute',
    rotate: 'none',
    scale: 'none',
    top: '0',
    // A class's own offset (an icon centred with `translate`) would move the copy off where it is put
    translate: 'none',
    width: `${w}px`,
    willChange: 'transform, opacity',
  })
  return copy
}

// A field's words, as their own layer: the input's text without its box, its left edge and centre line measured from
// the field's left edge and centre, and how wide the words run
interface Words {
  el: Part
  h: number
  font: number
  inset: number
  dy: number
  width: number
}

// How wide the input's words run in its own type, measured on a canvas so the launch frame lays nothing out again
const pen = () => document.createElement('canvas').getContext('2d')
const wordsWidth = (input: HTMLInputElement, style: CSSStyleDeclaration) => {
  const canvas = pen()
  if (canvas === null) {
    return input.clientWidth
  }
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return canvas.measureText(
    input.value === '' ? input.placeholder : input.value
  ).width
}

const wordsOf = (shell: HTMLElement, box: DOMRect): Words | null => {
  const face = shell.closest<HTMLElement>('[data-dock-face]') ?? shell
  const input =
    shell instanceof HTMLInputElement ? shell : face.querySelector('input')
  if (input === null) {
    return null
  }
  const style = getComputedStyle(input)
  const at = input.getBoundingClientRect()
  const room =
    input.clientWidth - px(style.paddingLeft) - px(style.paddingRight)
  const el = still(input, room, at.height)
  Object.assign(el.style, {
    background: 'transparent',
    border: '0',
    boxShadow: 'none',
    padding: '0',
    transformOrigin: '0 50%',
  })
  if (el instanceof HTMLInputElement) {
    el.value = input.value
  }
  return {
    dy: at.top + at.height / 2 - (box.top + box.height / 2),
    el,
    font: px(style.fontSize),
    h: at.height,
    inset:
      at.left + px(style.borderLeftWidth) + px(style.paddingLeft) - box.left,
    width: wordsWidth(input, style),
  }
}

// A small part pinned to one edge of its field: its gap to that edge and its centre line from the field's centre
interface Pinned {
  el: Part
  w: number
  h: number
  gap: number
  dy: number
  // The field's height it was measured in, so it can scale with the box
  of: number
}

const pinned = (part: Part, box: DOMRect, edge: 'left' | 'right'): Pinned => {
  const at = part.getBoundingClientRect()
  const el = still(part, at.width, at.height)
  el.style.transformOrigin = edge === 'left' ? '0 50%' : '100% 50%'
  return {
    dy: at.top + at.height / 2 - (box.top + box.height / 2),
    el,
    gap: edge === 'left' ? at.left - box.left : box.right - at.right,
    h: at.height,
    of: box.height,
    w: at.width,
  }
}

// The bar's search icon: the one the field or button draws itself, not one inside another button (Clear Search)
const iconOf = (shell: HTMLElement) => {
  const face = shell.closest<HTMLElement>('[data-dock-face]') ?? shell
  return (
    [...face.querySelectorAll<SVGElement>('svg')].find((svg) => {
      const button = svg.closest('button')
      return drawn(svg) && (button === null || button === shell)
    }) ?? null
  )
}

// The field's action: Generate Lyrics, or its round icon on a phone
const actionOf = (field: HTMLElement) =>
  [...field.querySelectorAll<HTMLElement>('button[type="submit"]')].find(
    drawn
  ) ?? null

interface Flight {
  shell: HTMLElement
  // The bar search's height, where the pill ends up
  barH: number
  page: Words | null
  bar: Words | null
  icon: Pinned | null
  pill: Pinned | null
}

const flightOf = (field: HTMLElement, shell: HTMLElement): Flight => {
  const from = field.getBoundingClientRect()
  const to = shell.getBoundingClientRect()
  const icon = iconOf(shell)
  const action = actionOf(field)
  return {
    bar: wordsOf(shell, to),
    barH: to.height,
    icon: icon === null ? null : pinned(icon, to, 'left'),
    page: wordsOf(field, from),
    pill: action === null ? null : pinned(action, from, 'right'),
    shell,
  }
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

const boxOf = (r: DOMRect): Box => ({
  bottom: r.bottom,
  left: r.left,
  right: r.right,
  top: r.top,
})

// One leg of a flight: from where the ghost was when it set off to where it lands, `at` (0 at the field, 1 in the
// bar) going from `from` to `goal` on the same eased progress as the box
interface Leg {
  depart: Box
  // What it sets off from, read again in the first frame (a bar still sliding in has moved since the scroll that
  // started the flight); none for a flight turned around, which sets off from where its box was drawn
  leaving: HTMLElement | null
  from: number
  goal: number
  start: number | null
}

// Each part of the ghost at `at` (0 at the field, 1 in the bar), in a box `width` × `height`
const drawParts = (
  flight: Flight,
  at: number,
  width: number,
  height: number
) => {
  const { page, bar, icon, pill } = flight
  const mid = height / 2
  // The pill keeps its gap to the right end, scaled with the box's height, and fades out over the first half of the
  // flight. Its size goes straight from full at the field to 60% of the bar's height in the bar, in step with the box,
  // so neither of its edges ever runs past where it ends up
  let reserve = 0
  if (pill !== null) {
    const k = height / pill.of
    const gone = ramp(at, 0, 0.5)
    const scale = mix(1, (0.6 * flight.barH) / pill.of, at)
    const right = width - pill.gap * k
    reserve = width - right + pill.w * scale
    pill.el.style.transform = `translate(${right - pill.w}px, ${mid + pill.dy * k - pill.h / 2}px) scale(${scale})`
    pill.el.style.opacity = String(1 - gone)
  }
  // The words slide from the field's inset to the bar's at one size, the two copies crossfading on the same line
  // (`search-ghost-text` adds them, so they neither double nor thin). As the box closes in on them (a phone's field
  // flying into a round button) they fade out over the last half of their width of room, gone before they'd touch
  const words = [page, bar].filter((w) => w !== null)
  if (page !== null) {
    const end = bar ?? page
    const inset = mix(page.inset, end.inset, at)
    const font = mix(page.font, end.font, at)
    const dy = mix(page.dy, end.dy, at)
    const room = Math.min(
      Math.max((width - reserve - inset - page.width) / (page.width / 2), 0),
      1
    )
    const swap = bar === null ? 0 : ramp(at, 0.15, 0.55)
    for (const w of words) {
      const scale = font / w.font
      w.el.style.transform = `translate(${inset}px, ${mid + dy - w.h / 2}px) scale(${scale})`
      w.el.style.opacity = String((w === page ? 1 - swap : swap) * room)
    }
  }
  // The bar's icon keeps its gap to the left edge and fades in once the words have slid clear of it
  if (icon !== null) {
    icon.el.style.transform = `translate(${icon.gap}px, ${mid + icon.dy - icon.h / 2}px)`
    icon.el.style.opacity = String(ramp(at, 0.4, 1))
  }
}

const dock = (
  field: HTMLElement,
  header: HTMLElement,
  ghost: HTMLElement,
  setStage: (stage: DockStage) => void
) => {
  // Where the search is, 0 at the field and 1 in the bar, and the box last drawn
  let at = 0
  let drawnBox: Box | null = null
  let leg: Leg | null = null
  let frame = 0
  let docked = false
  let flight: Flight | null = null
  let shown: DockStage = 'page'
  // A handover between the ghost and the real search lands in one frame. Never flushed from React's own effects:
  // the stage there is already the one asked for
  const show = (next: DockStage) => {
    if (next !== shown) {
      shown = next
      flushSync(() => {
        setStage(next)
      })
    }
  }

  // The bar's bottom edge on screen (slid away on a phone, only the status bar's)
  const barBottom = () => header.getBoundingClientRect().bottom
  const target = () =>
    [...header.querySelectorAll<HTMLElement>('[data-dock-shell]')].find(
      drawn
    ) ?? null

  const wants = () => {
    // The installed app's tab bar carries search, and the top bar keeps no search button
    if (document.documentElement.dataset.tabbar !== undefined) {
      return false
    }
    const { top, bottom } = field.getBoundingClientRect()
    if (!docked) {
      // Under a bar that has slid away (globals.css hides its row on this rule) the ghost would fly unseen, so the
      // field docks once it has left the screen whole: it never vanishes in view
      const barGone = document.documentElement.matches(
        "[data-topbar-state='hidden']:not(:has([data-generation-panel]))"
      )
      return barGone ? bottom < 0 : top < barBottom()
    }
    // A search being typed into in the bar stays there
    const typing =
      header.querySelector('[data-dock-slot]:focus-within') !== null
    return typing || top <= barBottom() + RETURN_PX
  }

  // The ghost at progress `p` of the current leg: every edge the same share of the way from where it set off to the
  // live box it lands on, and every part placed from that box in the same frame
  const draw = (p: number) => {
    if (flight === null || leg === null) {
      return
    }
    at = mix(leg.from, leg.goal, p)
    const origin = header.getBoundingClientRect()
    const land = boxOf(
      (leg.goal === 1 ? flight.shell : field).getBoundingClientRect()
    )
    const { depart } = leg
    const box: Box = {
      bottom: mix(depart.bottom, land.bottom, p),
      left: mix(depart.left, land.left, p),
      right: mix(depart.right, land.right, p),
      top: mix(depart.top, land.top, p),
    }
    drawnBox = box
    const width = box.right - box.left
    const height = box.bottom - box.top
    ghost.style.transform = `translate(${box.left - origin.left}px, ${box.top - origin.top}px)`
    ghost.style.width = `${width}px`
    ghost.style.height = `${height}px`
    ghost.style.setProperty('--dock-t', String(at))
    // Solid over the page, see-through like the bar's own field as it reaches the bar (`search-ghost`)
    ghost.style.setProperty('--dock-under', String(1 - ramp(at, 0.6, 1)))
    drawParts(flight, at, width, height)
  }

  // The bar's search is mounted ahead of a flight, out of sight, so a launch frame has no component to build. Home
  // again it stays mounted, hidden, and if something was typed in it, it is mounted afresh a moment later, empty: the
  // two fields don't share what is typed
  let mounting: ReturnType<typeof setTimeout> | undefined
  const mountSoon = () => {
    clearTimeout(mounting)
    mounting = setTimeout(() => {
      const typed = [
        ...header.querySelectorAll<HTMLInputElement>('[data-dock-slot] input'),
      ].some((input) => input.value !== '')
      if (shown === 'ready' && typed) {
        show('page')
      }
      if (shown === 'page') {
        show('ready')
      }
    }, MOUNT_AFTER_MS)
  }

  const settle = () => {
    // The real search shows in the same frame the ghost goes
    show(docked ? 'bar' : 'ready')
    flight = null
    leg = null
    drawnBox = null
    ghost.replaceChildren()
    if (!docked) {
      field.style.opacity = ''
      mountSoon()
    }
  }

  const launch = () => {
    // The bar's search is there first (mounted now if it wasn't yet), so the flight knows where it lands
    clearTimeout(mounting)
    show('flying')
    const shell = target()
    if (shell === null) {
      // Nowhere to land (the bar draws no search): the search stays where it was, and the next scroll asks again
      docked = !docked
      show(docked ? 'bar' : 'page')
      return
    }
    const quiet = reducedMotion()
    // Under Reduce Motion there is no flight: the field fades where it is as the bar's search fades in
    field.style.transition = quiet ? 'opacity 150ms ease-out' : ''
    const from = paintOf(field)
    const to = paintOf(shell)
    ghost.style.setProperty('--dock-from-edge', from.edge)
    ghost.style.setProperty('--dock-from-fill', from.fill)
    ghost.style.setProperty('--dock-to-edge', to.edge)
    ghost.style.setProperty('--dock-to-fill', to.fill)
    // A flight turned around keeps the copies it has and sets off from where its box is; a new one copies both ends
    // and sets off from where the search shows now (the field, the bar's search)
    const setOff = docked ? field : shell
    const leaving = drawnBox === null ? setOff : null
    flight ??= flightOf(field, shell)
    leg = {
      depart: drawnBox ?? boxOf((leaving ?? field).getBoundingClientRect()),
      from: at,
      goal: docked ? 1 : 0,
      leaving,
      start: null,
    }
    const { page, bar, icon, pill } = flight
    const text = document.createElement('div')
    text.className = 'search-ghost-text'
    text.append(...[page, bar].flatMap((w) => (w === null ? [] : [w.el])))
    ghost.replaceChildren(
      text,
      ...[icon, pill].flatMap((p) => (p === null ? [] : [p.el]))
    )
    // The ghost carries the search from here, in the frame the real one hides
    field.style.opacity = '0'
    if (quiet) {
      cancelAnimationFrame(frame)
      frame = 0
      at = leg.goal
      settle()
      return
    }
    draw(0)
    // The first frame shows the ghost where it sets off, exactly over what it takes over from; the last shows it
    // exactly on what it lands on, and the next hands over to it
    if (frame === 0) {
      let landed = false
      const tick = (now: number) => {
        if (leg === null) {
          frame = 0
          return
        }
        if (landed) {
          frame = 0
          settle()
          return
        }
        if (leg.start === null) {
          leg.start = now
          if (leg.leaving !== null) {
            leg.depart = boxOf(leg.leaving.getBoundingClientRect())
          }
        }
        const x = Math.min((now - leg.start) / FLIGHT_MS, 1)
        draw(easeOut(x))
        landed = x === 1
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }
  }

  const steer = () => {
    const want = wants()
    if (want !== docked) {
      docked = want
      launch()
    }
  }

  // A page that opens already scrolled starts with the search in the bar
  docked = wants()
  if (docked) {
    at = 1
    field.style.opacity = '0'
  }
  shown = docked ? 'bar' : 'page'
  setStage(shown)
  if (!docked) {
    mountSoon()
  }

  // Focus leaving the bar's field can send the search home; read once focus has landed
  let refocus = 0
  const onFocusOut = () => {
    cancelAnimationFrame(refocus)
    refocus = requestAnimationFrame(steer)
  }
  document.addEventListener('scroll', steer, { capture: true, passive: true })
  globalThis.addEventListener('resize', steer)
  header.addEventListener('focusout', onFocusOut)
  return () => {
    cancelAnimationFrame(frame)
    cancelAnimationFrame(refocus)
    clearTimeout(mounting)
    document.removeEventListener('scroll', steer, { capture: true })
    globalThis.removeEventListener('resize', steer)
    header.removeEventListener('focusout', onFocusOut)
    ghost.replaceChildren()
    field.style.opacity = ''
    field.style.transition = ''
  }
}

// Where home's search is while `on`; elsewhere always 'page'. The bar renders its search (`data-dock-slot`, its
// edge marked `data-dock-shell`) for any stage but 'page', and lets it be reached only at 'bar'; the ghost is an
// empty `search-ghost` box in the bar
export const useSearchDock = (
  on: boolean,
  header: RefObject<HTMLElement | null>,
  ghost: RefObject<HTMLDivElement | null>
): DockStage => {
  const field = useAtomValue(homeSearchFieldAtom)
  const [stage, setStage] = useState<DockStage>('page')
  useEffect(() => {
    const bar = header.current
    const box = ghost.current
    return on && field !== null && bar !== null && box !== null
      ? dock(field, bar, box, setStage)
      : undefined
  }, [on, field, header, ghost])
  return on ? stage : 'page'
}

// The top bar's search: whether it shows, the props of its wrappers (`data-dock-slot`), and on home the ghost that
// flies between home's field and the bar. Search shows on every page but Search, which is a field of its own, and
// the full-screen player; on home, once its field has scrolled under the bar, and only reachable once it lands
export const useBarSearch = (
  isVideoPlayer: boolean,
  header: RefObject<HTMLElement | null>
) => {
  const { pathname } = useLocation()
  const ghost = useRef<HTMLDivElement>(null)
  const home = pathname === '/' && !isVideoPlayer
  const stage = useSearchDock(home, header, ghost)
  const waiting = home && stage !== 'bar'
  return {
    ghost: home ? (
      <div ref={ghost} aria-hidden inert className='search-ghost' />
    ) : null,
    shown:
      !isVideoPlayer && pathname !== '/search' && (!home || stage !== 'page'),
    slot: {
      // Under Reduce Motion there is no flight, so the bar's search fades in and out where it is, as the field does,
      // instead of popping; with motion the ghost hands over to it in one frame
      className: cn(
        waiting && 'opacity-0',
        'motion-reduce:transition-opacity motion-reduce:duration-150'
      ),
      'data-dock-slot': true,
      inert: waiting,
    },
  }
}
