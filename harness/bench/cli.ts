// synbox bench.
//
//   bun harness/bench/cli.ts check [--jobs 3]             exact checks, browser audits scoped to the branch's diff;
//                                                          stamps the verdict the PR hook reads
//   bun harness/bench/cli.ts check --full                  every audit, never reusing a verdict; the release runs this
//   bun harness/bench/cli.ts check --only <id prefix>,…    just those audits, while working (no verdict)
//   bun harness/bench/cli.ts scope                         what a scoped check would run here, and why, without running it
//   bun harness/bench/cli.ts trend [--only <id>,…] [--ref origin/main] [--reference <commit>]
//                                                          timing benches, candidate vs pinned reference → .harness/queue.md
//   bun harness/bench/cli.ts list                          every benchmark, and which command runs it
//   bun harness/bench/cli.ts serve [--port N]              the bench's server for this working tree, for driving by hand

import { parseArgs } from 'node:util'

import { buildWorkingTree } from './build'
import { runCheck, scopeReport } from './check'
import { closeBrowsers } from './engines/browser'
import { holdMachine } from './lock'
import { serveBuild } from './server'
import { repoAt, storeDir } from './store'
import { SUITE } from './suite'
import { runTrend } from './trend'
import { isExact } from './types'

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    full: { type: 'boolean' },
    jobs: { default: '3', type: 'string' },
    only: { type: 'string' },
    port: { type: 'string' },
    ref: { default: 'origin/main', type: 'string' },
    reference: { type: 'string' },
  },
})
const [command = 'check'] = positionals
const log = (m: string): void => {
  process.stderr.write(`· ${m}\n`)
}
const only = flags.only?.split(',') ?? null
const jobsOf = (raw: string): number => {
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`--jobs must be a positive whole number, not "${raw}"`)
  }
  return Number(raw)
}

const main = async () => {
  const repo = repoAt(process.cwd())
  switch (command) {
    case 'check': {
      if (flags.full === true && only !== null) {
        throw new Error('--full and --only exclude each other')
      }
      // No machine lock for the whole run: audits share the machine with other sessions' through browser slots, and
      // timing audits take it to themselves (lock.ts)
      const r = await runCheck(repo, {
        full: flags.full === true,
        jobs: jobsOf(flags.jobs),
        log,
        only,
      })
      let stamp = ` → ${r.verdict ?? ''}`
      if (r.verdict === null) {
        stamp = repo.dirty
          ? ' (uncommitted changes: no verdict; commit, then run again)'
          : ' (--only: no verdict)'
      } else if (r.reused !== null) {
        stamp = ` (reused from ${r.reused.slice(0, 8)}) → ${r.verdict}`
      }
      // A retried audit is what makes a slow run slow (a stuck one waits out its time limit first): said on the last
      // line, so a run read through \`tail -1\` still shows it
      const retried = r.steps.filter((st) =>
        st.detail.includes('retried after')
      )
      const retries =
        retried.length === 0
          ? ''
          : ` (retried: ${retried.map((st) => `${st.name}, ${st.detail.split('retried after: ')[1] ?? ''}`).join('; ')})`
      process.stdout.write(
        `\ncheck ${r.status.toUpperCase()} in ${Math.round(r.wallMs / 1000)}s${retries}${stamp}\n`
      )
      process.exitCode = r.status === 'fail' ? 3 : 0
      break
    }
    case 'scope': {
      process.stdout.write(`${scopeReport(repo)}\n`)
      break
    }
    case 'trend': {
      const release = await holdMachine(repo, 'trend', log)
      try {
        const outcome = await runTrend(repo, {
          log,
          only,
          ref: flags.ref,
          reference: flags.reference,
        })
        process.exitCode = outcome === 'regressed' ? 3 : 0
      } finally {
        release()
      }
      break
    }
    case 'list': {
      for (const b of SUITE) {
        process.stdout.write(
          `${b.id.padEnd(34)} ${isExact(b) ? 'check' : 'trend'}  ${b.title}\n`
        )
      }
      break
    }
    case 'serve': {
      const dist = await buildWorkingTree(repo, log)
      const server = serveBuild({
        distDir: dist,
        fixturesDir: storeDir(repo, 'bench', 'fixtures'),
        mode: 'replay',
        port: Number(flags.port ?? 0),
        repoTop: repo.top,
      })
      process.stdout.write(`${server.origin}\n`)
      // oxlint-disable-next-line promise/avoid-new -- a promise that never settles keeps the command running until Ctrl-C
      await new Promise(() => {
        // never settles
      })
      break
    }
    default: {
      throw new Error(
        `unknown command ${command}; see the top of harness/bench/cli.ts`
      )
    }
  }
}

try {
  await main()
} catch (error) {
  process.stderr.write(
    `bench: ${error instanceof Error ? error.message : String(error)}\n`
  )
  await closeBrowsers()
  process.exitCode = 1
}
