// When a control acts: on release inside it, never on the press (good apps let a finger
// that landed on the wrong thing slide off and lift without anything happening). The rules, per element and input,
// are in docs/private/2026-10-26-activation-timing-research.md (WCAG 2.5.2 Pointer Cancellation; UIKit
// touchUpInside; Compose Press/Release/Cancel):
//   - anything that acts (button, link, tab, radio, switch, checkbox, menu item, option, row) acts on release inside;
//   - a press that slides off and lifts outside, or turns into a scroll (pointercancel), does nothing;
//   - with a mouse only, a menu or list trigger (aria-haspopup) may open on the press, so press, drag and release
//     picks an item; it may do nothing else, and lifting outside its items picks nothing;
//   - direct manipulation (sliders, the seek bar, drags, swipe rows, sortable lists, the carousel) starts on the press
//     and says so with `data-press-ok="<why>"`; an element that acts (a tab, a link, a menu item…) may never carry it.
// The scan presses each candidate with synthetic pointer (and touch) events, which the app's handlers see as a real
// press, but which never make the browser's own click: so anything that changes is the app acting on a press. With a
// mouse: press, slide off, lift outside. On a phone: press then cancel (a scroll took it), and press, slide off, lift
// outside. "Changed" is what a person would see as the control acting: a tab, radio, switch or menu state
// (aria-selected/checked/pressed/expanded, data-state), a menu, list or dialog appearing, the URL, or a request that
// writes (anything but GET). Candidates: every control whose own React props handle a press or a lift, plus one of
// each other kind on the page. Noise (a player's own timers flipping state) is read for a moment before each press
// and left out.

import type { Page, Request } from 'playwright'

import type { Surface } from '../types'

/** Roles and tags that act, so may never claim `data-press-ok` */
const ACTING =
  'a[href],[role=tab],[role=radio],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=option],[role=switch],[role=checkbox],[role=link],input[type=checkbox],input[type=radio],summary'
const CANDIDATES = `button,[role=button],${ACTING},[data-press-ok]`
/** Elements a scan presses at most: the ones with press handlers first */
const MAX_TESTED = 24
const QUIET_MS = 60
const AFTER_MS = 90

interface Candidate {
  n: number
  label: string
  /** Its own React props handle a press or a lift */
  handled: boolean
  pressOk: string | null
  acting: boolean
  popup: boolean
}

interface Tried {
  /** It left the page before its turn (an earlier press closed what held it) */
  gone: boolean
  press: string[]
  release: string[]
}

export interface PressFindings {
  /** Controls that acted on the press (`input: label → what changed`) */
  actsOnPress: string[]
  /** Controls that acted when a press slid off and lifted outside, or was cancelled */
  actsOnReleaseOutside: string[]
  /** `data-press-ok` on a control that acts */
  badPressOk: string[]
  tested: number
}

declare global {
  interface Window {
    __press?: {
      changes: string[]
      els: Element[]
    }
  }
}

/** Watches what a person would see as a control acting; numbers the candidates as `data-press-probe` */
const prepare = async (page: Page): Promise<Candidate[]> =>
  await page.evaluate(
    ({ candidates, acting, max }) => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const label = (el: Element): string => {
        const role = el.getAttribute('role') ?? el.tagName.toLowerCase()
        const name = (
          el.getAttribute('aria-label') ??
          el.textContent ??
          el.getAttribute('title') ??
          ''
        )
          .replaceAll(/\s+/gu, ' ')
          .trim()
          .slice(0, 40)
        return `${role} "${name}"`
      }
      if (window.__press === undefined) {
        const state = { changes: [] as string[], els: [] as Element[] }
        window.__press = state
        const watched = new Set([
          'aria-selected',
          'aria-checked',
          'aria-pressed',
          'aria-expanded',
          'aria-current',
          'data-state',
        ])
        // A tooltip trigger's hover states are not the control acting
        const tooltipStates = new Set([
          'closed',
          'delayed-open',
          'instant-open',
        ])
        new MutationObserver((records) => {
          for (const r of records) {
            if (r.type === 'attributes' && r.attributeName !== null) {
              if (
                !watched.has(r.attributeName) ||
                !(r.target instanceof Element)
              ) {
                continue
              }
              const now = r.target.getAttribute(r.attributeName)
              if (now === r.oldValue) {
                continue
              }
              if (
                r.attributeName === 'data-state' &&
                tooltipStates.has(r.oldValue ?? 'closed') &&
                tooltipStates.has(now ?? 'closed')
              ) {
                continue
              }
              state.changes.push(
                `${label(r.target)} ${r.attributeName} ${r.oldValue} → ${now}`
              )
            } else if (r.type === 'childList') {
              for (const node of r.addedNodes) {
                if (!(node instanceof Element)) {
                  continue
                }
                const opened = node.matches(
                  '[role=menu],[role=listbox],[role=dialog],[role=alertdialog]'
                )
                  ? node
                  : node.querySelector(
                      '[role=menu],[role=listbox],[role=dialog],[role=alertdialog]'
                    )
                if (opened !== null) {
                  state.changes.push(`opened ${label(opened)}`)
                }
              }
            }
          }
        }).observe(document, {
          attributeOldValue: true,
          attributes: true,
          childList: true,
          subtree: true,
        })
      }
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const shown = (el: Element): boolean => {
        const r = el.getBoundingClientRect()
        if (
          r.width < 1 ||
          r.height < 1 ||
          r.bottom <= 0 ||
          r.right <= 0 ||
          r.top >= innerHeight ||
          r.left >= innerWidth
        ) {
          return false
        }
        if (
          el.matches(':disabled,[aria-disabled=true]') ||
          getComputedStyle(el).visibility === 'hidden' ||
          getComputedStyle(el).pointerEvents === 'none'
        ) {
          return false
        }
        const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2))
        const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))
        const top = document.elementFromPoint(x, y)
        return (
          top !== null && (top === el || el.contains(top) || top.contains(el))
        )
      }
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const pressOkOf = (el: Element): string | null =>
        el instanceof HTMLElement ? (el.dataset.pressOk ?? null) : null
      const HANDLERS = [
        'onPointerDown',
        'onMouseDown',
        'onTouchStart',
        'onPointerUp',
        'onMouseUp',
        'onTouchEnd',
      ]
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const kind = (el: Element): string =>
        [
          el.getAttribute('role') ?? el.tagName.toLowerCase(),
          el.getAttribute('aria-haspopup') ?? '',
          el
            .closest(
              '[role=menu],[role=listbox],[role=tablist],[role=radiogroup],[role=dialog],nav,header'
            )
            ?.getAttribute('role') ??
            el
              .closest(
                '[role=menu],[role=listbox],[role=tablist],[role=radiogroup],[role=dialog],nav,header'
              )
              ?.tagName.toLowerCase() ??
            '',
        ].join('|')
      // React keeps an element's props on it, under a key it names `__reactProps$<random>`
      const hasHandler = (el: Element) => {
        const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))
        if (key === undefined) {
          return false
        }
        const props: unknown = Reflect.get(el, key)
        return (
          typeof props === 'object' &&
          props !== null &&
          HANDLERS.some((h) => typeof Reflect.get(props, h) === 'function')
        )
      }
      const all = [...document.querySelectorAll(candidates)].filter(
        (el) => pressOkOf(el) !== null || shown(el)
      )
      // Anything else whose own props take a press or a lift (a row, a drag surface), whatever its role
      const listed = new Set(all)
      const others = [...document.querySelectorAll('body *')].filter(
        (el) =>
          !listed.has(el) &&
          hasHandler(el) &&
          (pressOkOf(el) !== null || shown(el))
      )
      const handled = [...all.filter(hasHandler), ...others]
      const seen = new Set(handled.map(kind))
      const sampled = all.filter((el) => {
        if (handled.includes(el) || pressOkOf(el) !== null) {
          return false
        }
        const k = kind(el)
        if (seen.has(k)) {
          return false
        }
        seen.add(k)
        return true
      })
      const allowed = all.filter(
        (el) => pressOkOf(el) !== null && !handled.includes(el)
      )
      // The allowlisted first, as they are only read, not pressed; then what must be pressed
      // Things that act first (options, tabs, links), then plain buttons: a button that acts on its press (Clear
      // Search) can close the list the options are in
      const okFirst = [...handled, ...allowed].filter(
        (el) => pressOkOf(el) !== null
      )
      const pressed = [...handled, ...sampled]
        .filter((el) => pressOkOf(el) === null)
        .slice(0, max)
        .toSorted(
          (a, b) => Number(b.matches(acting)) - Number(a.matches(acting))
        )
      const picked = [...okFirst, ...pressed]
      const state = window.__press
      state.els = picked
      return picked.map((el, n) => ({
        acting: el.matches(acting),
        handled: handled.includes(el),
        label: label(el),
        n,
        popup: (el.getAttribute('aria-haspopup') ?? 'false') !== 'false',
        pressOk: pressOkOf(el),
      }))
    },
    { acting: ACTING, candidates: CANDIDATES, max: MAX_TESTED }
  )

/** One press of candidate `n` with synthetic events, then a cancel or a lift outside; what changed after each */
const tryPress = async (
  page: Page,
  n: number,
  touch: boolean,
  end: 'cancel' | 'outside'
): Promise<Tried> =>
  await page.evaluate(
    async ({ index, onPhone, ending, quiet, after }) => {
      const state = window.__press
      const el = state?.els[index]
      if (state === undefined || el === undefined || !el.isConnected) {
        return { gone: true, press: [], release: [] }
      }
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const wait = async (ms: number) => {
        // oxlint-disable-next-line promise/avoid-new -- a timer
        await new Promise((resolve) => {
          setTimeout(resolve, ms)
        })
      }
      // What changes on its own (a player's timers) is noise, read before the press
      state.changes = []
      await wait(quiet)
      const noise = new Set(
        state.changes.map((c) => c.replace(/ \S+ → \S+$/u, ''))
      )
      const fresh = () => {
        const got = state.changes.filter(
          (c) => !noise.has(c.replace(/ \S+ → \S+$/u, ''))
        )
        state.changes = []
        return got
      }
      state.changes = []
      const { href } = location
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      // Well outside it (80px past its edge), above when there's room: a slide down on the player is its own gesture
      // (drag to minimise), so a slide-off down there would test that instead of the control
      const oy =
        r.top - 80 > 2 ? r.top - 80 : Math.min(innerHeight - 2, r.bottom + 80)
      const pointer = (type: string, cx: number, cy: number) =>
        new PointerEvent(type, {
          bubbles: true,
          button: type === 'pointermove' ? -1 : 0,
          buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          composed: true,
          isPrimary: true,
          pointerId: onPhone ? 7 : 1,
          pointerType: onPhone ? 'touch' : 'mouse',
          view: window,
        })
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const mouse = (type: string, cx: number, cy: number) =>
        new MouseEvent(type, {
          bubbles: true,
          button: 0,
          buttons: type === 'mousedown' ? 1 : 0,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          composed: true,
          view: window,
        })
      const touchEvent = (
        type: string,
        cx: number,
        cy: number
      ): Event | null => {
        try {
          const t = new Touch({
            clientX: cx,
            clientY: cy,
            identifier: 7,
            target: el,
          })
          const live = type === 'touchstart' ? [t] : []
          return new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            changedTouches: [t],
            composed: true,
            targetTouches: live,
            touches: live,
          })
        } catch {
          return null
        }
      }
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const send = (target: Element, e: Event | null) => {
        if (e !== null) {
          target.dispatchEvent(e)
        }
      }
      send(el, pointer('pointerdown', x, y))
      if (onPhone) {
        send(el, touchEvent('touchstart', x, y))
      } else {
        send(el, mouse('mousedown', x, y))
      }
      await wait(after)
      const press = fresh()
      if (location.href !== href) {
        press.push(`navigated to ${location.pathname}${location.search}`)
      }
      if (onPhone) {
        // A touch stays with the element it landed on: its moves and lift go there, wherever the finger is
        if (ending === 'cancel') {
          send(el, pointer('pointercancel', x, y))
          send(el, touchEvent('touchcancel', x, y))
        } else {
          send(el, pointer('pointermove', x, oy))
          send(el, pointer('pointerup', x, oy))
          send(el, touchEvent('touchend', x, oy))
        }
      } else {
        const out = document.elementFromPoint(x, oy) ?? document.body
        send(out, pointer('pointermove', x, oy))
        send(out, mouse('mousemove', x, oy))
        send(out, pointer('pointerup', x, oy))
        send(out, mouse('mouseup', x, oy))
      }
      await wait(after)
      const release = fresh()
      if (
        location.href !== href &&
        !press.some((c) => c.startsWith('navigated'))
      ) {
        release.push(`navigated to ${location.pathname}${location.search}`)
      }
      return { gone: false, press, release }
    },
    { after: AFTER_MS, ending: end, index: n, onPhone: touch, quiet: QUIET_MS }
  )

const NONE: PressFindings = {
  actsOnPress: [],
  actsOnReleaseOutside: [],
  badPressOk: [],
  tested: 0,
}

export const pressNotes = (f: PressFindings): string[] => [
  ...f.actsOnPress.map((m) => `acts on the press: ${m}`),
  ...f.actsOnReleaseOutside.map(
    (m) => `acts though the press was taken back: ${m}`
  ),
  ...f.badPressOk.map((m) => `data-press-ok on a control that acts: ${m}`),
]

export const pressValues = (f: PressFindings) => ({
  actsOnPress: f.actsOnPress.length,
  actsOnReleaseOutside: f.actsOnReleaseOutside.length,
  badPressOk: f.badPressOk.length,
  pressTested: f.tested,
})

/** Presses every candidate on the page as it is now (the audit's last step: it may change the page) */
export const pressScan = async (
  page: Page,
  touch: boolean
): Promise<PressFindings> => {
  const findings: PressFindings = {
    actsOnPress: [],
    actsOnReleaseOutside: [],
    badPressOk: [],
    tested: 0,
  }
  const candidates = await prepare(page)
  let writes: string[] = []
  const onRequest = (request: Request) => {
    const { pathname } = new URL(request.url())
    // The app's own writes: the YouTube player's frame posts its own stats and logs as it plays, and Sentry's
    // envelopes (tunnelled through /api/<project>/envelope/) report, they don't act
    if (
      request.frame() === page.mainFrame() &&
      request.method() !== 'GET' &&
      request.method() !== 'HEAD' &&
      !/\/envelope\/?$/u.test(pathname)
    ) {
      writes.push(`${request.method()} ${pathname}`)
    }
  }
  page.on('request', onRequest)
  const input = touch ? 'touch' : 'mouse'
  try {
    for (const c of candidates) {
      if (c.pressOk !== null) {
        if (c.acting) {
          findings.badPressOk.push(`${c.label} (data-press-ok="${c.pressOk}")`)
        } else if (c.pressOk.trim() === '') {
          findings.badPressOk.push(`${c.label} (data-press-ok gives no reason)`)
        }
        continue
      }
      const ends: ('cancel' | 'outside')[] = touch
        ? ['cancel', 'outside']
        : ['outside']
      for (const end of ends) {
        writes = []
        // oxlint-disable-next-line eslint/no-await-in-loop -- one press at a time
        const tried = await tryPress(page, c.n, touch, end)
        if (tried.gone) {
          break
        }
        if (end === ends[0]) {
          findings.tested += 1
        }
        // With a mouse, a menu or list trigger may open on the press (press, drag, release picks an item)
        const popupOpens = (change: string) =>
          /^opened (?:menu|listbox|dialog) /u.test(change) ||
          (change.startsWith(`${c.label} `) &&
            /^ (?:aria-expanded|data-state) /u.test(
              change.slice(c.label.length)
            ))
        const onPress =
          !touch && c.popup
            ? tried.press.filter((ch) => !popupOpens(ch))
            : tried.press
        const afterLift = [...tried.release, ...writes]
        const onPressNote = `${input}: ${c.label} → ${onPress.join('; ')}`
        // Each control once: a phone presses it twice (then a scroll, then a slide off)
        if (onPress.length > 0 && !findings.actsOnPress.includes(onPressNote)) {
          findings.actsOnPress.push(onPressNote)
        }
        // What already acted on the press isn't counted again for the lift that followed
        if (afterLift.length > 0 && onPress.length === 0) {
          findings.actsOnReleaseOutside.push(
            `${input} ${end === 'cancel' ? 'press then scroll' : 'press, slide off, lift'}: ${c.label} → ${afterLift.join('; ')}`
          )
        }
        const changed = [...tried.press, ...tried.release]
        if (changed.some((ch) => ch.startsWith('opened'))) {
          // Close what the press opened (the top layer only), so the next candidate sees the page as it was
          // oxlint-disable-next-line eslint/no-await-in-loop -- one press at a time
          await page.keyboard.press('Escape')
          // oxlint-disable-next-line eslint/no-await-in-loop -- one press at a time
          await page.waitForTimeout(250)
        }
        if (changed.some((ch) => ch.startsWith('navigated'))) {
          // A press that navigated leaves the page it was auditing: stop here, the finding is made
          return findings
        }
      }
    }
  } finally {
    page.off('request', onRequest)
  }
  return findings
}

/** The scan in the views that have it: the website and the installed app (Safari has the same engine as the app) */
export const pressScanIn = async (
  page: Page,
  surface: Surface
): Promise<PressFindings> =>
  surface.kind === 'desktop' || surface.installed === true
    ? await pressScan(page, surface.kind === 'phone')
    : NONE
