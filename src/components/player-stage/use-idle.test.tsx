// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import type { RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { useIdle } from './use-idle'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const IDLE_MS = 1800

const get = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) {
    throw new Error(selector)
  }
  return element
}

// The watch page: the stage, its control bar, the top bar (marked as floating UI for the full-screen stage) and the
// page around them. happy-dom answers (hover: hover) like a desktop, and matches :focus-visible as :focus
const page = () => {
  document.documentElement.dataset.watch = ''
  document.body.innerHTML = `
    <div data-top-bar data-player-chrome><button aria-expanded="false">Library</button></div>
    <div data-stage><div data-player-chrome><button>Mute</button></div></div>
    <div data-page></div>
    <div data-app></div>`
  return {
    app: get('[data-app]'),
    mute: get('[data-stage] button'),
    pageBody: get('[data-page]'),
    stage: get('[data-stage]'),
    topBar: get('[data-top-bar] button'),
  }
}

let root: Root | null = null
const state = { idle: false, outside: false }

const Probe = ({ stageRef }: { stageRef: RefObject<HTMLElement> }) => {
  const { idle, outside } = useIdle(IDLE_MS, stageRef)
  useEffect(() => {
    state.idle = idle
    state.outside = outside
  })
  return null
}

const mount = (stage: HTMLElement, app: HTMLElement) => {
  act(() => {
    root = createRoot(app)
    root.render(<Probe stageRef={{ current: stage }} />)
  })
}

const pointer = (
  type: string,
  target: EventTarget,
  init: { relatedTarget?: EventTarget | null } = {}
) => {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: type !== 'pointerleave',
        pointerType: 'mouse',
        ...init,
      })
    )
  })
}

const elapse = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  vi.useRealTimers()
  delete document.documentElement.dataset.watch
})

test('on the watch page, a mouse leaving the video for the top bar idles the controls at once', () => {
  const { app, stage, topBar } = page()
  mount(stage, app)
  pointer('pointermove', stage)
  expect(state.idle).toBe(false)

  pointer('pointerleave', stage, { relatedTarget: topBar })

  expect(state).toEqual({ idle: true, outside: true })
})

test('on the watch page, a mouse moving on the page that never crossed the video idles the controls at once', () => {
  const { app, pageBody, stage } = page()
  mount(stage, app)
  expect(state.idle).toBe(false)

  pointer('pointermove', pageBody)

  expect(state).toEqual({ idle: true, outside: true })
})

test('an open menu holds the controls after the mouse leaves, and they go as soon as it closes', () => {
  const { app, mute, pageBody, stage } = page()
  mount(stage, app)
  pointer('pointermove', stage)
  mute.setAttribute('aria-expanded', 'true')

  pointer('pointerleave', stage, { relatedTarget: pageBody })
  elapse(IDLE_MS * 2)
  expect(state).toEqual({ idle: false, outside: true })

  mute.setAttribute('aria-expanded', 'false')
  elapse(200)
  expect(state.idle).toBe(true)
})

test('a button focused by a click, then a key press, does not hold the controls once the mouse leaves', () => {
  const { app, mute, pageBody, stage } = page()
  mount(stage, app)
  // A click on Mute focuses it; a key pressed after it makes it :focus-visible
  pointer('pointerdown', mute)
  mute.focus()
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))
  })

  pointer('pointerleave', stage, { relatedTarget: pageBody })
  expect(state).toEqual({ idle: true, outside: true })
})

test('focus moved into the controls by Tab still holds them', () => {
  const { app, mute, stage } = page()
  mount(stage, app)
  pointer('pointerdown', stage)
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
  })
  mute.focus()

  elapse(IDLE_MS * 3)
  expect(state.idle).toBe(false)
})
