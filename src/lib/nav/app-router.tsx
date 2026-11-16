import { startTransition, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import {
  UNSAFE_createBrowserHistory as createBrowserHistory,
  NavigationType,
  Router,
} from 'react-router'
import type { Location } from 'react-router'

import { isInstalledPhone } from '@/lib/pwa'
import { reducedMotion } from '@/lib/reduced-motion'

import { rememberScroll, restoreScroll } from './scroll-memory'
import { isTabRoot, navKind } from './transition-kind'
import type { NavKind } from './transition-kind'

interface Shown {
  action: NavigationType
  location: Location
}

// Whether the browser already animated the Back or Forward under way (a swipe from the screen's edge on iOS,
// Android's predictive back, a trackpad swipe). Read on the event before the router hears it: animating again
// would play the page change twice
// A browser that doesn't say (`hasUAVisualTransition` missing: null here) is taken to have drawn every Back on
// a touch screen that the app didn't ask for itself (appAskedAt): there that is the edge swipe
let osAnimated: boolean | null = false
window.addEventListener(
  'popstate',
  (event) => {
    const told: unknown = event.hasUAVisualTransition
    osAnimated = typeof told === 'boolean' ? told : null
  },
  { capture: true }
)
// When the app last moved through the history itself (a Back button of its own, navigate(-1))
const APP_ASK_WINDOW_MS = 1000
let appAskedAt = Number.NEGATIVE_INFINITY

// A page change that draws its own way there (the mini bar growing into the player, the player dragged down
// into it) asks for the next one to go unanimated here
const SKIP_WINDOW_MS = 1000
let skipUntil = 0
export const skipNextNavTransition = () => {
  skipUntil = performance.now() + SKIP_WINDOW_MS
}

const tabKey = (pathname: string) => `tab:${pathname}`

// Another view transition (Lock Landscape's turn, Theater Mode) is drawing: a second one would cut it short
const otherTransitionRuns = () => {
  const { transition, theaterMove } = document.documentElement.dataset
  return transition !== undefined || theaterMove !== undefined
}

const kindOf = (from: Shown, to: Shown): NavKind => {
  const skipped = performance.now() < skipUntil
  skipUntil = 0
  const touch = matchMedia('(pointer: coarse)').matches
  const appAsked = performance.now() - appAskedAt < APP_ASK_WINDOW_MS
  const drawn =
    to.action === NavigationType.Pop && (osAnimated ?? (touch && !appAsked))
  osAnimated = false
  appAskedAt = Number.NEGATIVE_INFINITY
  if (
    skipped ||
    typeof document.startViewTransition !== 'function' ||
    otherTransitionRuns()
  ) {
    return 'none'
  }
  return navKind({
    from: from.location.pathname,
    osAnimated: drawn,
    reducedMotion: reducedMotion(),
    replace: to.action === NavigationType.Replace,
    to: to.location.pathname,
    touch,
  })
}

// React Router's BrowserRouter, with one addition: every page change passes through here, which decides how it
// moves (transition-kind.ts), runs it as a view transition (globals.css › html[data-nav]) and keeps each page's
// scroll place (scroll-memory.ts). Links and navigate() stay as they are
const history = createBrowserHistory({ v5Compat: true })
const go = history.go.bind(history)
history.go = (delta) => {
  appAskedAt = performance.now()
  go(delta)
}

// Runs `commit` (the new page's render) inside a view transition of that kind. The attribute goes when it is
// done or failed, unless a later page change already took over
let running: ViewTransition | null = null
const moveTo = (kind: Exclude<NavKind, 'none'>, commit: () => void) => {
  const root = document.documentElement
  root.dataset.nav = kind
  const transition = document.startViewTransition(() => {
    flushSync(commit)
  })
  running = transition
  const settle = async () => {
    try {
      await transition.finished
    } finally {
      if (running === transition) {
        running = null
        delete root.dataset.nav
      }
    }
  }
  void settle()
}

const AppRouter = ({ children }: { children: ReactNode }) => {
  const [shown, setShown] = useState<Shown>({
    action: history.action,
    location: history.location,
  })
  // The page last asked for, which a slow render may not show yet
  const asked = useRef(shown)

  useLayoutEffect(
    () =>
      history.listen(({ action, location }) => {
        const from = asked.current
        const to = { action, location }
        asked.current = to
        const samePage = from.location.pathname === location.pathname
        if (!samePage) {
          rememberScroll(
            from.location.key,
            ...(isTabRoot(from.location.pathname)
              ? [tabKey(from.location.pathname)]
              : [])
          )
        }
        const kind = kindOf(from, to)
        if (kind === 'none') {
          startTransition(() => {
            setShown(to)
          })
          return
        }
        moveTo(kind, () => {
          setShown(to)
        })
      }),
    []
  )

  // Back and Forward return to where the page was left; in the installed app a tab does too, as a phone's own
  // tabs keep their place. In a layout effect, so a transition's snapshot of the new page is taken there
  const previous = useRef(shown)
  useLayoutEffect(() => {
    const from = previous.current
    previous.current = shown
    const { pathname, key } = shown.location
    if (from === shown || from.location.pathname === pathname) {
      return
    }
    if (shown.action === NavigationType.Pop) {
      restoreScroll(key)
    } else if (
      shown.action === NavigationType.Push &&
      isInstalledPhone() &&
      isTabRoot(pathname)
    ) {
      restoreScroll(tabKey(pathname))
    }
  }, [shown])

  return (
    <Router
      location={shown.location}
      navigationType={shown.action}
      navigator={history}>
      {children}
    </Router>
  )
}

export default AppRouter
