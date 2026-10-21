// Layout audit of one page on one screen: every visible press target is checked for size (WCAG 2.2's 24px
// minimum), for being covered at its centre by something else (a press would land on the wrong thing), for
// sticking out of the viewport, and, when fixed or sticky on a phone, for sitting under the status bar or home
// indicator. Landmark positions are recorded so a move can be reported. Layout is deterministic: one run.

import path from 'node:path'

import type { Page } from 'playwright'

import { mark, open } from '../engines/browser'
import type { Audit } from '../engines/recorder'
import type { BenchContext, Sample, Surface } from '../types'

export type LayoutPage = 'home' | 'gallery' | 'player' | 'search'

const prepare: Record<
  LayoutPage,
  { path: string; ready: (page: Page) => Promise<void> }
> = {
  gallery: {
    path: '/',
    ready: async (page) => {
      // Tiles lazy-load their images, so on a short screen they only load once scrolled to. The sections above
      // must have their content first: scrolling before they grow leaves the title far below the viewport
      const toTitle = async () => {
        await page.evaluate(() =>
          document
            .querySelector('#gallery-title')
            ?.scrollIntoView({ block: 'start' })
        )
      }
      await mark(page, 'carousel-slide')
      await mark(page, 'charts-done')
      await toTitle()
      await mark(page, 'gallery-tile')
      await toTitle()
      await page.waitForTimeout(800)
    },
  },
  home: {
    path: '/',
    ready: async (page) => {
      await mark(page, 'carousel-slide')
      await mark(page, 'charts-row')
    },
  },
  player: {
    path: '/v/6rG_irmOQsM',
    ready: async (page) => {
      await mark(page, 'lyrics-line', 30_000)
      // WebKit in Playwright may never play the video; audit whatever the player settled into, controls shown
      await page.waitForTimeout(3000)
      await page
        .locator('[data-player-stage]')
        .hover({ force: true, position: { x: 40, y: 40 } })
        .catch(() => {
          // The hover only brings the controls back; audit the page either way
        })
      await page.waitForTimeout(400)
    },
  },
  search: {
    path: '/search?q=yoasobi',
    ready: async (page) => {
      await mark(page, 'search-result', 30_000)
    },
  },
}

export const layoutAudit =
  (which: LayoutPage, surface: Surface) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    const { page, close, safe } = await open(surface)
    try {
      const p = prepare[which]
      await page.goto(`${ctx.origin}${p.path}`, { waitUntil: 'commit' })
      await p.ready(page)
      const audit: Audit = await page.evaluate(
        (s) => window.__bench.audit(s),
        safe
      )
      await page.screenshot({ path: path.join(ctx.artifactDir, 'screen.png') })
      const phase = await page.evaluate(
        () =>
          document.querySelector<HTMLElement>('[data-player-stage]')?.dataset
            .phase
      )
      const notes = [
        ...audit.small.map(
          (t) =>
            `small ${t.rect.w}×${t.rect.h} at ${t.rect.x},${t.rect.y}: ${t.label}`
        ),
        ...audit.occluded.map((o) => `covered: ${o.label} under ${o.by}`),
        ...audit.offscreen.map(
          (t) => `off-screen at x=${t.rect.x}: ${t.label}`
        ),
        ...audit.unsafe.map(
          (t) =>
            `in a safe-area inset at ${t.rect.x},${t.rect.y} ${t.rect.w}×${t.rect.h}: ${t.label}`
        ),
        ...(audit.overflowX
          ? [`page scrolls sideways by ${audit.overflowX}px`]
          : []),
        ...(phase !== undefined && phase !== ''
          ? [`player phase at audit: ${phase}`]
          : []),
      ]
      return {
        errors: [],
        samples: [
          {
            landmarks: audit.landmarks,
            notes,
            values: {
              occludedTargets: audit.occluded.length,
              offscreenTargets: audit.offscreen.length,
              overflowXPx: audit.overflowX,
              smallTargets: audit.small.length,
              targets: audit.targets,
              unsafeTargets: audit.unsafe.length,
            },
          },
        ],
      }
    } catch (error) {
      await page
        .screenshot({ path: path.join(ctx.artifactDir, 'screen.png') })
        .catch(() => {
          // The run already failed; a missing screenshot of it changes nothing
        })
      const message = error instanceof Error ? error.message : String(error)
      return { errors: [message.split('\n')[0]], samples: [] }
    } finally {
      await close()
    }
  }
