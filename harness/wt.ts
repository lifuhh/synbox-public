// A task's worktree, from start to clean-up, without anything forced or killed by name.
//
//   bun harness/wt.ts start <type>/<slug> [--session <name>]   worktree ../synbox-<slug> on a new branch from staging, installed
//   bun harness/wt.ts serve                                      (in the worktree) its dev server on a free port; run it as a
//                                                                background task and stop it by that task, never by port or name
//   bun harness/wt.ts finish <slug>                              keep its reports, remove the worktree, delete the merged branch
//
// `finish` refuses instead of forcing: uncommitted changes, a branch not merged into staging, or its dev server
// still running each stop it with what to do. Nothing here kills a process, so nothing can stop another session's.

import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'
import { parseArgs } from 'node:util'

const STAGING = 'staging'
const TYPES = ['feat', 'fix', 'chore', 'docs', 'perf']
const FIRST_PORT = 5173
const LAST_PORT = 5299

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: { session: { type: 'string' } },
})

const run = (cmd: string, args: string[], cwd: string, inherit = false) => {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    stdio: inherit ? 'inherit' : 'pipe',
  })
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed: ${(result.stderr ?? '').trim().slice(0, 400)}`
    )
  }
  return (result.stdout ?? '').trim()
}

const git = (cwd: string, ...args: string[]) =>
  run('git', ['-C', cwd, ...args], cwd)

const stop: (message: string) => never = (message) => {
  console.error(message)
  process.exit(1)
}

// The main checkout of this script's own repo, from wherever it is run: from another repo's directory (the
// backend's, by absolute path) it once made a worktree of that repo instead
const mainCheckout = () =>
  path.dirname(
    git(
      import.meta.dirname,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir'
    )
  )

const worktreePath = (slug: string) =>
  path.join(path.dirname(mainCheckout()), `synbox-${slug}`)

const gitDir = (cwd: string) =>
  git(cwd, 'rev-parse', '--path-format=absolute', '--git-dir')

// Where `serve` notes the port it took, in the worktree's own git dir
const portFile = (cwd: string) => path.join(gitDir(cwd), 'dev-port')

const reaches = async (host: string, port: number) => {
  const socket = connect({ host, port })
  try {
    await once(socket, 'connect')
    return true
  } catch {
    return false
  } finally {
    socket.destroy()
  }
}

// Something answers on the port, on either loopback address (Vite listens on localhost, often ::1 only)
const answers = async (port: number) => {
  const open = await Promise.all([
    reaches('127.0.0.1', port),
    reaches('::1', port),
  ])
  return open.some(Boolean)
}

const start = (branch: string | undefined) => {
  const [type, slug] = branch?.split('/') ?? []
  if (!(type && slug && TYPES.includes(type) && /^[a-z0-9-]+$/u.test(slug))) {
    stop(`Usage: wt start <${TYPES.join('|')}>/<slug>, slug in a-z, 0-9 and -`)
  }
  const main = mainCheckout()
  const dir = worktreePath(slug)
  if (existsSync(dir)) {
    stop(`${dir} already exists: pick another slug, or finish that task first`)
  }
  git(main, 'fetch', 'origin')
  git(
    main,
    'worktree',
    'add',
    dir,
    '-b',
    `${type}/${slug}`,
    `origin/${STAGING}`
  )
  if (flags.session !== undefined) {
    writeFileSync(path.join(gitDir(dir), 'agent-session'), `${flags.session}\n`)
  }
  run('bun', ['install'], dir, true)
  run('bun', ['install'], path.join(dir, 'worker'), true)
  console.log(dir)
}

const serve = async () => {
  const top = git(process.cwd(), 'rev-parse', '--show-toplevel')
  const ports = Array.from(
    { length: LAST_PORT - FIRST_PORT + 1 },
    (_, i) => FIRST_PORT + i
  )
  const taken = await Promise.all(ports.map(answers))
  const port = ports.find((_, i) => !taken[i])
  if (port === undefined) {
    stop(`No free port from ${FIRST_PORT} to ${LAST_PORT}`)
  }
  const file = portFile(top)
  writeFileSync(file, `${port}\n`)
  console.log(`http://localhost:${port}`)
  const server = spawn(
    'bunx',
    ['vp', 'dev', '--port', String(port), '--strictPort'],
    {
      cwd: top,
      stdio: 'inherit',
    }
  )
  // Stopping the task ends this process: the server it started goes with it, and the port note is cleared
  const end = () => {
    rmSync(file, { force: true })
    server.kill()
  }
  process.once('SIGTERM', end)
  process.once('SIGINT', end)
  server.once('exit', (code) => {
    rmSync(file, { force: true })
    process.exit(code ?? 0)
  })
}

const finish = async (slug: string | undefined) => {
  if (slug === undefined || !/^[a-z0-9-]+$/u.test(slug)) {
    stop('Usage: wt finish <slug>')
  }
  const main = mainCheckout()
  const dir = worktreePath(slug)
  if (!existsSync(dir)) {
    stop(`${dir} does not exist`)
  }
  const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
  if (git(dir, 'status', '--porcelain') !== '') {
    stop(
      `${dir} has uncommitted changes: commit them, or ask the user before throwing them away`
    )
  }
  git(main, 'fetch', 'origin')
  const merged =
    spawnSync('git', [
      '-C',
      dir,
      'merge-base',
      '--is-ancestor',
      'HEAD',
      `origin/${STAGING}`,
    ]).status === 0
  if (!merged) {
    stop(
      `${branch} is not merged into ${STAGING}: merge its PR first, or keep the worktree`
    )
  }
  const file = portFile(dir)
  if (existsSync(file)) {
    const port = Number(readFileSync(file, 'utf-8').trim())
    if (await answers(port)) {
      stop(
        `Its dev server still runs on port ${port}: stop the background task running \`wt serve\`, then finish`
      )
    }
    rmSync(file, { force: true })
  }
  // Reports are gitignored, so they would go with the worktree
  const reports = path.join(dir, '.reports')
  if (existsSync(reports)) {
    cpSync(reports, path.join(main, '.reports'), { recursive: true })
    console.log(`Reports kept in ${path.join(main, '.reports')}`)
  }
  git(main, 'worktree', 'remove', dir)
  git(main, 'branch', '-d', branch)
  console.log(`Removed ${dir} and ${branch}`)
}

const [command, arg] = positionals
if (command === 'start') {
  start(arg)
} else if (command === 'serve') {
  await serve()
} else if (command === 'finish') {
  await finish(arg)
} else {
  stop('Usage: bun harness/wt.ts start <type>/<slug> | serve | finish <slug>')
}
