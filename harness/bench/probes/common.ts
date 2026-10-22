import type { JSHandle, Page } from 'playwright'

import type { BenchContext, Sample } from '../types'

/** The number a waitForFunction settled on; it settles only on a truthy value, so null never gets here */
export const settledNumber = async (
  handle: JSHandle<number | null>
): Promise<number> => {
  const value = await handle.jsonValue()
  if (value === null) {
    throw new Error('waitForFunction settled on null')
  }
  return value
}

/** Runs a probe `runs` times after `ctx.warmup` discarded runs; a failed run becomes an error, not a sample */
export const repeat = async (
  ctx: BenchContext,
  runs: number,
  once: (run: number) => Promise<Sample>
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const { warmup } = ctx
  const samples: Sample[] = []
  const errors: string[] = []
  for (let i = -warmup; i < runs; i += 1) {
    ctx.log(i < 0 ? 'warm-up' : `run ${i + 1}/${runs}`)
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- measurements must run one at a time
      const s = await once(i)
      if (i >= 0) {
        samples.push(s)
      }
    } catch (error) {
      errors.push(
        `${i < 0 ? 'warm-up' : `run ${i + 1}`}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`
      )
    }
  }
  return { errors, samples }
}

/** ms from the last probe input (pointerdown/keydown) to the player entering `phase` */
export const phaseAfterInput = async (
  page: Page,
  phase: string,
  timeoutMs = 15_000
): Promise<number> => {
  const handle = await page.waitForFunction(
    (p) => {
      const b = window.__bench
      const hit = b.phases.find(
        (x) => x.phase === p && x.t >= (b.marks.input ?? 0)
      )
      return hit ? hit.t - (b.marks.input ?? 0) : null
    },
    phase,
    { timeout: timeoutMs }
  )
  return await settledNumber(handle)
}
