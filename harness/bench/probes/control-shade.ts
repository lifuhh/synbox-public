// The player's controls on a phone on its side are never sat in a shade wider than they are (owner, 2026-10-26: in
// Lock Landscape the control bar's 80%-black gradient ran the stage's whole length behind the buttons and the rail's
// corner and read as a haze over them: "How did this pass verification"). With the controls shown, every visible
// control on the stage (the bar, the rail, the corner buttons) is checked against the painted layers around it: a layer
// with a background, gradient or backdrop filter, not the control itself, many times its size, covering a good part of
// it, is a shade over or under it. Full-stage backdrops (behind the video) don't count. Each shaded control counts 1;
// the count gates in `check` at 0. Run on the installed app on its side, and upright turned by Lock Landscape.

import path from 'node:path'

import type { Page } from 'playwright'

import { open } from '../engines/browser'
import type { BenchContext, Sample, Surface } from '../types'
import { LAYOUT_PAGES, PLAYER_SONG } from './layout'

const LIMIT_MS = 90_000
/** A layer this many times a control's area, or more, is a band, not the control's own disc or pill */
const BAND_FACTOR = 6
/** A band covering this share of a control's box sits over or under it */
const COVER_SHARE = 0.25

/** Full Screen, then Lock Landscape: the upright phone's page turned a quarter */
const turnPage = async (page: Page) => {
  for (const name of ['Fullscreen', 'Lock Landscape']) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one press, then the next
    const pressed = await page.evaluate((label) => {
      const button = document.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`
      )
      button?.click()
      return button !== null
    }, name)
    if (!pressed) {
      throw new Error(`no "${name}" button to turn the page`)
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the stage settles before the next press
    await page.waitForTimeout(1200)
  }
}

const shadeAudit = async (
  surface: Surface,
  url: string,
  turned: boolean,
  screenshot: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const player = LAYOUT_PAGES.find((p) => p.name === 'player')
  if (player === undefined) {
    throw new Error('no player page in LAYOUT_PAGES')
  }
  const { page, close } = await open(surface)
  try {
    await page.goto(url, { waitUntil: 'commit' })
    await player.ready(page)
    if (turned) {
      await turnPage(page)
    }
    // The controls show on a tap on the stage
    const centre = await page.evaluate(() => {
      const r = document
        .querySelector('[data-player-stage]')
        ?.getBoundingClientRect()
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
    })
    if (centre === null) {
      throw new Error('no player stage')
    }
    await page.touchscreen.tap(centre.x, centre.y)
    await page.waitForTimeout(600)
    const found = await page.evaluate(
      ({ bandFactor, coverShare }) => {
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
        const shown = (e: HTMLElement) => {
          const r = e.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) {
            return false
          }
          let opacity = 1
          for (let n: HTMLElement | null = e; n; n = n.parentElement) {
            const cs = getComputedStyle(n)
            if (cs.visibility === 'hidden' || cs.display === 'none') {
              return false
            }
            opacity *= Number(cs.opacity)
          }
          return opacity > 0.5
        }
        const stage = document.querySelector<HTMLElement>('[data-player-stage]')
        const rail = document.querySelector<HTMLElement>(
          'nav[aria-label="Player Controls"]'
        )
        const roots = [stage, rail?.parentElement].filter(
          (e): e is HTMLElement => e !== null && e !== undefined
        )
        const controls = roots
          .flatMap((root) => [...root.querySelectorAll<HTMLElement>('button')])
          .filter(shown)
        const stageBox = stage?.getBoundingClientRect()
        const stageArea = stageBox ? stageBox.width * stageBox.height : 0
        const painted = roots
          .flatMap((root) => [root, ...root.querySelectorAll<HTMLElement>('*')])
          .filter((e) => {
            if (e.closest('[data-stage-video]')) {
              return false
            }
            const cs = getComputedStyle(e)
            const r = e.getBoundingClientRect()
            return (
              r.width * r.height > 0 &&
              // A full-stage backdrop lies behind the video
              r.width * r.height < stageArea * 0.9 &&
              Number(cs.opacity) > 0.05 &&
              (cs.backgroundImage !== 'none' ||
                !/rgba\([^)]*,\s*0\)$|transparent/u.test(cs.backgroundColor) ||
                cs.backdropFilter !== 'none')
            )
          })
        const shaded: string[] = []
        for (const control of controls) {
          const c = control.getBoundingClientRect()
          const area = c.width * c.height
          for (const layer of painted) {
            if (layer === control || control.contains(layer)) {
              continue
            }
            const l = layer.getBoundingClientRect()
            const w = Math.min(c.right, l.right) - Math.max(c.left, l.left)
            const h = Math.min(c.bottom, l.bottom) - Math.max(c.top, l.top)
            if (
              w > 0 &&
              h > 0 &&
              (w * h) / area >= coverShare &&
              l.width * l.height >= area * bandFactor
            ) {
              const cs = getComputedStyle(layer)
              shaded.push(
                `${control.getAttribute('aria-label') ?? 'control'} in ${layer.tagName.toLowerCase()} ${Math.round(l.width)}×${Math.round(l.height)} (${cs.backgroundImage === 'none' ? cs.backgroundColor : cs.backgroundImage.slice(0, 60)}${cs.backdropFilter === 'none' ? '' : `, ${cs.backdropFilter}`})`
              )
              break
            }
          }
        }
        return { controls: controls.length, shaded }
      },
      { bandFactor: BAND_FACTOR, coverShare: COVER_SHARE }
    )
    await page.screenshot({ path: screenshot })
    if (found.controls === 0) {
      return { errors: ["the player's controls never showed"], samples: [] }
    }
    return {
      errors: [],
      samples: [
        {
          notes: found.shaded,
          values: {
            controls: found.controls,
            shadedControls: found.shaded.length,
          },
        },
      ],
    }
  } finally {
    await close()
  }
}

/** The player's controls in one view, shown: none sits in a shade band */
export const controlShadeAudit =
  (surface: Surface, turned: boolean) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
    const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
      (resolve) => {
        timer = setTimeout(() => {
          resolve({
            errors: [`control shade audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        shadeAudit(
          surface,
          `${ctx.origin}/v/${PLAYER_SONG}`,
          turned,
          path.join(ctx.artifactDir, 'screen.png')
        ).catch((error: unknown) => ({
          errors: [
            (error instanceof Error ? error.message : String(error)).split(
              '\n'
            )[0],
          ],
          samples: [],
        })),
        stuck,
      ])
    } finally {
      clearTimeout(timer)
    }
  }
