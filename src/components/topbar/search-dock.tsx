import { useAtomValue } from 'jotai'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useLocation } from 'react-router'

import { homeSearchFieldAtom } from '@/context/atoms'
import { reducedMotion } from '@/lib/reduced-motion'

// Home has its own search field. Once it scrolls under the top bar it flies up into the bar and becomes the bar's
// search (the field on a wide screen, the button on a phone); scrolled back, it flies home. One spring, 0 at the
// page's field and 1 in the bar, drives a ghost drawn between the two live boxes, so a flight turned around
// midway keeps its speed, and a flight home lands on the field wherever the scroll has taken it

// A critically damped spring: no bounce, settled in about 0.45 s, the feel of iOS's own transitions (motion's
// `visualDuration: 0.45, bounce: 0`). Hand-rolled: motion's animate() would bring its whole animation engine into
// the first load, where the top bar sits
const OMEGA = (2 * Math.PI) / 0.45
// A frame longer than this (a hidden tab, a stall) counts as this long, so the ghost never leaps
const MAX_STEP_S = 1 / 30

interface Spring {
  value: number
  velocity: number
  goal: number
}

// The spring's exact motion over `dt` seconds, so a long frame can't make it overshoot
const step = (spring: Spring, dt: number) => {
  const offset = spring.value - spring.goal
  const lead = spring.velocity + OMEGA * offset
  const decay = Math.exp(-OMEGA * dt)
  spring.value = spring.goal + (offset + lead * dt) * decay
  spring.velocity = (spring.velocity - OMEGA * lead * dt) * decay
}

const resting = (spring: Spring) =>
  Math.abs(spring.value - spring.goal) < 1e-3 &&
  Math.abs(spring.velocity) < 1e-2
// How far below the bar the page's field must come back before the search leaves the bar, so a scroll resting
// at the edge doesn't send it back and forth
const RETURN_PX = 16

// Where the search is: home's field, in flight, or in the bar
export type DockStage = 'page' | 'flying' | 'bar'

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

// A still copy of what a field shows (`data-dock-face`, or the shell itself), without the shell's edge and fill,
// and how far its face sits from the shell, so the copy can be laid with the shell on the ghost's box
interface Layer {
  el: HTMLElement
  shellH: number
  dx: number
  dy: number
}

const copyOf = (el: HTMLElement) => {
  const copy = el.cloneNode(true)
  if (!(copy instanceof HTMLElement)) {
    throw new TypeError('A copy of an element is an element')
  }
  return copy
}

const layerOf = (shell: HTMLElement): Layer => {
  const face = shell.closest<HTMLElement>('[data-dock-face]') ?? shell
  const faceBox = face.getBoundingClientRect()
  const shellBox = shell.getBoundingClientRect()
  const el = copyOf(face)
  const copies = [el, ...el.querySelectorAll<HTMLElement>('*')]
  const values = [face, ...face.querySelectorAll<HTMLElement>('*')]
  for (const [index, node] of copies.entries()) {
    const source = values[index]
    if (
      node instanceof HTMLInputElement &&
      source instanceof HTMLInputElement
    ) {
      node.value = source.value
    }
    if (source === shell) {
      node.style.borderColor = 'transparent'
      node.style.background = 'transparent'
      node.style.boxShadow = 'none'
    }
    for (const name of [
      'id',
      'data-bench',
      'data-dock-shell',
      'data-dock-face',
    ]) {
      node.removeAttribute(name)
    }
  }
  Object.assign(el.style, {
    height: `${faceBox.height}px`,
    left: '0',
    margin: '0',
    position: 'absolute',
    top: '0',
    transformOrigin: '0 0',
    width: `${faceBox.width}px`,
  })
  return {
    dx: faceBox.left - shellBox.left,
    dy: faceBox.top - shellBox.top,
    el,
    shellH: shellBox.height,
  }
}

// The copy scaled to the ghost's height, its shell's top left on the ghost's
const place = (layer: Layer, height: number, opacity: number) => {
  const scale = height / layer.shellH
  layer.el.style.transform = `scale(${scale}) translate(${layer.dx}px, ${layer.dy}px)`
  layer.el.style.opacity = String(opacity)
}

interface Flight {
  shell: HTMLElement
  page: Layer
  bar: Layer
  // Flying up, the page's end of the flight stays under the bar while the field scrolls on past it
  stick: number
}

const dock = (
  field: HTMLElement,
  header: HTMLElement,
  ghost: HTMLElement,
  setStage: (stage: DockStage) => void,
  slotShown: RefObject<(() => void) | null>
) => {
  const t: Spring = { goal: 0, value: 0, velocity: 0 }
  let frame = 0
  let docked = false
  let waiting = false
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

  // The bar's bottom edge on screen: slid away on a phone, only the status bar, so a field scrolling up under a
  // hidden bar docks unseen as it leaves the screen instead of flying into a bar that isn't there
  const barBottom = () => header.getBoundingClientRect().bottom
  const target = () =>
    [...header.querySelectorAll<HTMLElement>('[data-dock-shell]')].find(
      (el) => el.getClientRects().length > 0
    ) ?? null

  const wants = () => {
    // The installed app's tab bar carries search, and the top bar keeps no search button
    if (document.documentElement.dataset.tabbar !== undefined) {
      return false
    }
    const { top } = field.getBoundingClientRect()
    if (!docked) {
      return top < barBottom()
    }
    // A search being typed into in the bar stays there
    const typing =
      header.querySelector('[data-dock-slot]:focus-within') !== null
    return typing || top <= barBottom() + RETURN_PX
  }

  const draw = () => {
    if (flight === null) {
      return
    }
    const at = t.value
    const origin = header.getBoundingClientRect()
    const from = field.getBoundingClientRect()
    const to = flight.shell.getBoundingClientRect()
    const height = mix(from.height, to.height, at)
    const x = mix(from.left, to.left, at) - origin.left
    const y = mix(Math.max(from.top, flight.stick), to.top, at) - origin.top
    ghost.style.transform = `translate(${x}px, ${y}px)`
    ghost.style.width = `${mix(from.width, to.width, at)}px`
    ghost.style.height = `${height}px`
    ghost.style.setProperty('--dock-t', String(at))
    // The field's face is gone before the bar's comes in, so the two never show at once as a muddle of both
    place(flight.page, height, 1 - ramp(at, 0, 0.35))
    place(flight.bar, height, ramp(at, 0.2, 0.6))
  }

  const settle = () => {
    // The real search shows in the same frame the ghost goes
    show(docked ? 'bar' : 'page')
    flight = null
    ghost.replaceChildren()
    if (!docked) {
      field.style.opacity = ''
    }
  }

  const launch = () => {
    const shell = target()
    if (shell === null) {
      return
    }
    const from = paintOf(field)
    const to = paintOf(shell)
    ghost.style.setProperty('--dock-from-edge', from.edge)
    ghost.style.setProperty('--dock-from-fill', from.fill)
    ghost.style.setProperty('--dock-to-edge', to.edge)
    ghost.style.setProperty('--dock-to-fill', to.fill)
    flight = {
      bar: layerOf(shell),
      page: layerOf(field),
      shell,
      stick: Math.min(field.getBoundingClientRect().top, barBottom()),
    }
    ghost.replaceChildren(flight.page.el, flight.bar.el)
    // The ghost carries the search from here, in the frame the real one hides
    field.style.opacity = '0'
    show('flying')
    t.goal = docked ? 1 : 0
    if (reducedMotion()) {
      cancelAnimationFrame(frame)
      frame = 0
      t.value = t.goal
      t.velocity = 0
      settle()
      return
    }
    draw()
    // A flight under way just turns: its frames already run, and its speed carries over
    if (frame === 0) {
      let last = performance.now()
      const tick = () => {
        const now = performance.now()
        step(t, Math.min((now - last) / 1000, MAX_STEP_S))
        last = now
        if (resting(t)) {
          t.value = t.goal
          t.velocity = 0
          frame = 0
          settle()
          return
        }
        draw()
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }
  }

  const steer = () => {
    const want = wants()
    if (want === docked) {
      return
    }
    docked = want
    // The bar's search mounts first, so the flight knows where it lands
    if (target() === null) {
      waiting = true
      shown = 'flying'
      setStage(shown)
      return
    }
    launch()
  }
  slotShown.current = () => {
    if (waiting) {
      waiting = false
      launch()
    }
  }

  // A page that opens already scrolled starts with the search in the bar
  docked = wants()
  if (docked) {
    t.value = 1
    t.goal = 1
    field.style.opacity = '0'
  }
  shown = docked ? 'bar' : 'page'
  setStage(shown)

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
    document.removeEventListener('scroll', steer, { capture: true })
    globalThis.removeEventListener('resize', steer)
    header.removeEventListener('focusout', onFocusOut)
    slotShown.current = null
    ghost.replaceChildren()
    field.style.opacity = ''
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
  const slotShown = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    if (stage !== 'page') {
      slotShown.current?.()
    }
  }, [stage])
  useEffect(() => {
    const bar = header.current
    const box = ghost.current
    return on && field !== null && bar !== null && box !== null
      ? dock(field, bar, box, setStage, slotShown)
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
      className: waiting ? 'opacity-0' : undefined,
      'data-dock-slot': true,
      inert: waiting,
    },
  }
}
