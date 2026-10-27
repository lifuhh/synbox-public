// The other half of press timing (press.ts scans every control with synthetic presses): real input, on one page's
// top bar, proving each kind of control still acts when it should, and the cancels a person uses work. With a mouse
// (trusted Chromium input): a tab chosen by a click, not by a press that slid off; the account menu opened on the
// press, an item picked by dragging onto it and releasing, nothing picked by releasing outside; a dialog button that
// does nothing when its press slides off, and opens on a click. On a phone (trusted WebKit taps): a tab chosen by a
// tap, the menu opened by a tap and an item picked by a tap, and when, in the tap's events, the tab was chosen.
// Also measured, for docs/private/2026-10-26-activation-timing-research.md (noted, not gated): when a right press
// fires `contextmenu`, and whether a native <select> opens on the press.

import path from 'node:path'

import type { Page } from 'playwright'

import { open } from '../engines/browser'
import type { BenchContext, Sample, Surface } from '../types'
import { signIn } from './layout'

const LIMIT_MS = 60_000
const PAGE = '/privacy'

declare global {
  interface Window {
    /** Right-button events seen so far (the contextmenu measurement) */
    __pressSeen?: string[]
    /** A tap's events, and when in them the tab was chosen */
    __pressTapLog?: string[]
  }
}

const centre = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox()
  if (box === null) {
    throw new Error(`no box for ${selector}`)
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const attr = async (page: Page, selector: string, name: string) =>
  await page.locator(selector).first().getAttribute(name)

/** Presses at `from`, moves well away, releases there: a press taken back */
const slideOff = async (page: Page, from: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.waitForTimeout(120)
  await page.mouse.move(from.x, from.y + 260, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

const LIBRARY = '[data-press-probe=library]'
const MORE = '[data-press-probe=more]'
const BELL = '[data-press-probe=notifications]'
const SECOND_TAB = '[role=dialog] [role=tab]:nth-of-type(2)'

/** Tags the top bar's buttons by what a screen reader announces (their names live in hidden text, not attributes) */
const tagTopBar = async (page: Page) => {
  for (const [key, name] of [
    ['library', 'Library'],
    // Signed in (run below): the account button, which a guest sees as More
    ['more', 'Account'],
    ['notifications', /^Notifications/u],
  ] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one button at a time
    await page
      .getByRole('button', { exact: true, name })
      .first()
      .evaluate((el, k) => {
        if (el instanceof HTMLElement) {
          el.dataset.pressProbe = k
        }
      }, key)
  }
}

/** Opens the page afresh, its top bar tagged */
const reload = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'commit' })
  await page
    .getByRole('button', { exact: true, name: 'Library' })
    .first()
    .waitFor({ timeout: 20_000 })
    .catch((error: unknown) => {
      throw new Error(`no Library button on ${page.url()}: ${String(error)}`)
    })
  await tagTopBar(page)
}

const mouseRun = async (
  page: Page,
  values: Record<string, number>,
  notes: string[]
) => {
  // A tab: a press that slides off chooses nothing; a click chooses it
  await page.locator(LIBRARY).click()
  await page.locator(SECOND_TAB).waitFor()
  await slideOff(page, await centre(page, SECOND_TAB))
  values.tabSlideOffSelects = Number(
    (await attr(page, SECOND_TAB, 'aria-selected')) === 'true'
  )
  await page.locator(SECOND_TAB).click()
  await page.waitForTimeout(200)
  values.tabClickFails = Number(
    (await attr(page, SECOND_TAB, 'aria-selected')) !== 'true'
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // The menu: open on the press, release outside its items picks nothing and leaves it open
  const more = await centre(page, MORE)
  const url = page.url()
  await slideOff(page, more)
  const stillOpen = (await attr(page, MORE, 'aria-expanded')) === 'true'
  values.menuReleaseOutsidePicks = Number(page.url() !== url)
  notes.push(
    `mouse: account menu after a press released outside it: ${stillOpen ? 'open' : 'closed'}, nothing picked: ${page.url() === url}`
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // Press, drag onto the first item, release: picks it (the menu closes; an item that navigates, navigates)
  await page.mouse.move(more.x, more.y)
  await page.mouse.down()
  const item = page.locator('[role=menu] [role=menuitem]').first()
  await item.waitFor({ timeout: 3000 })
  const text = await item.textContent()
  const name = text?.trim() ?? ''
  const box = await item.boundingBox()
  if (box === null) {
    throw new Error('the first menu item has no box')
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 8,
  })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const picked =
    page.url() !== url || (await page.locator('[role=menu]').count()) === 0
  values.menuDragPickFails = Number(!picked)
  notes.push(
    `mouse: press, drag to "${name}", release: ${picked ? 'picked' : 'not picked'}`
  )
  if (page.url() !== url) {
    await reload(page, url)
  }

  // A dialog button: a press that slides off opens nothing; a click opens it
  await slideOff(page, await centre(page, BELL))
  values.buttonSlideOffActs = await page.locator('[role=dialog]').count()
  await page.locator(BELL).click()
  values.buttonClickFails = Number(
    !(await page
      .locator('[role=dialog]')
      .first()
      .waitFor({ timeout: 3000 })
      .then(
        () => true,
        () => false
      ))
  )
  await page.keyboard.press('Escape')

  // Measured for the research doc: when a right press fires contextmenu, and whether a <select> opens on the press
  const timing = await page.evaluate(() => {
    const seen: string[] = []
    for (const type of ['mousedown', 'mouseup', 'contextmenu']) {
      window.addEventListener(
        type,
        (e) => {
          if (e instanceof MouseEvent && e.button === 2) {
            seen.push(type)
            if (type === 'contextmenu') {
              e.preventDefault()
            }
          }
        },
        true
      )
    }
    const select = document.createElement('select')
    select.id = 'press-probe-select'
    select.innerHTML = '<option>One</option><option>Two</option>'
    select.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:9999'
    document.body.append(select)
    window.__pressSeen = seen
    return true
  })
  if (timing) {
    await page.mouse.move(200, 400)
    await page.mouse.down({ button: 'right' })
    const atPress = await page.evaluate(() => [...(window.__pressSeen ?? [])])
    await page.mouse.up({ button: 'right' })
    notes.push(
      `measured: right press → events by the press: ${atPress.join(', ') || 'none'} (contextmenu ${atPress.includes('contextmenu') ? 'on the press' : 'on the release'})`
    )
    const s = await centre(page, '#press-probe-select')
    await page.mouse.move(s.x, s.y)
    await page.mouse.down()
    const openOnPress = await page.evaluate(() => {
      try {
        return (
          document.querySelector('#press-probe-select')?.matches(':open') ??
          null
        )
      } catch {
        return null
      }
    })
    await page.mouse.up()
    await page.keyboard.press('Escape')
    notes.push(
      `measured: native <select> open while the mouse is still down: ${openOnPress === null ? 'not readable (:open unsupported)' : String(openOnPress)}`
    )
  }
}

const touchRun = async (
  page: Page,
  values: Record<string, number>,
  notes: string[]
) => {
  // When, in a real tap's events, the tab is chosen
  await page.locator(LIBRARY).tap()
  await page.locator(SECOND_TAB).waitFor()
  await page.evaluate((sel) => {
    const log: string[] = []
    window.__pressTapLog = log
    const at = { current: 'none' }
    for (const type of [
      'pointerdown',
      'touchstart',
      'pointerup',
      'touchend',
      'mousedown',
      'mouseup',
      'click',
    ]) {
      window.addEventListener(
        type,
        () => {
          at.current = type
          log.push(type)
        },
        true
      )
    }
    const tab = document.querySelector(sel)
    if (tab !== null) {
      new MutationObserver(() => {
        log.push(`SELECTED during ${at.current}`)
      }).observe(tab, { attributeFilter: ['aria-selected'], attributes: true })
    }
  }, SECOND_TAB)
  await page.locator(SECOND_TAB).tap()
  await page.waitForTimeout(300)
  values.tabTapFails = Number(
    (await attr(page, SECOND_TAB, 'aria-selected')) !== 'true'
  )
  const log = await page.evaluate(() => window.__pressTapLog ?? [])
  notes.push(`measured: a tap on a tab: ${log.join(' → ')}`)
  await page.keyboard.press('Escape').catch(() => {
    // A phone may have no keyboard focus to take it; the dialog is closed below either way
  })
  await reload(page, page.url())

  // The menu: a tap opens it, a tap on an item picks it
  const url = page.url()
  await page.locator(MORE).tap()
  const opened = await page
    .locator('[role=menu]')
    .first()
    .waitFor({ timeout: 3000 })
    .then(
      () => true,
      () => false
    )
  values.menuTapFails = Number(!opened)
  if (opened) {
    await page.locator('[role=menu] [role=menuitem]').first().tap()
    await page.waitForTimeout(500)
    const picked =
      page.url() !== url || (await page.locator('[role=menu]').count()) === 0
    values.itemTapFails = Number(!picked)
  } else {
    values.itemTapFails = 1
  }
}

const run = async (
  surface: Surface,
  origin: string,
  shot: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  // No service worker: after the first load it would fetch the sign-in check itself, past signIn's route
  const { page, close } = await open(surface, { serviceWorkers: 'block' })
  const values: Record<string, number> = {
    buttonClickFails: 0,
    buttonSlideOffActs: 0,
    itemTapFails: 0,
    menuDragPickFails: 0,
    menuReleaseOutsidePicks: 0,
    menuTapFails: 0,
    tabClickFails: 0,
    tabSlideOffSelects: 0,
    tabTapFails: 0,
  }
  const notes: string[] = []
  try {
    // Signed in: a guest's top bar has no Library or bell to press
    await signIn(page)
    await reload(page, `${origin}${PAGE}`)
    await (surface.kind === 'phone'
      ? touchRun(page, values, notes)
      : mouseRun(page, values, notes))
    await page.screenshot({ path: shot })
    return { errors: [], samples: [{ notes, values }] }
  } catch (error) {
    await page.screenshot({ path: shot }).catch(() => {
      // The run already failed
    })
    return {
      errors: [
        (error instanceof Error ? error.message : String(error)).split('\n')[0],
      ],
      samples: [],
    }
  } finally {
    await close()
  }
}

export const PRESS_RELEASE_FINDINGS = [
  'tabSlideOffSelects',
  'tabClickFails',
  'menuReleaseOutsidePicks',
  'menuDragPickFails',
  'buttonSlideOffActs',
  'buttonClickFails',
  'tabTapFails',
  'menuTapFails',
  'itemTapFails',
] as const

/** Real presses on the top bar in one view: each kind of control acts when it should, and its cancels work */
export const pressReleaseAudit =
  (surface: Surface) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
    const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
      (resolve) => {
        timer = setTimeout(() => {
          resolve({
            errors: [`press-release audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        run(surface, ctx.origin, path.join(ctx.artifactDir, 'screen.png')),
        stuck,
      ])
    } finally {
      clearTimeout(timer)
    }
  }
