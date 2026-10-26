// A production build of a checkout, served by Netlify's own local runtime (netlify-cli `dev` over the built dist/):
// the Netlify functions (/api/youtube/*, /api/library/songs), the page-head Edge Function and the sitemap, netlify.toml's redirects (the
// /api proxies to the live auth Worker) and its headers, as on Netlify, for no build minutes. smoke.ts --local and
// release.ts run the smoke test on it before anything is built on Netlify.
//
//   bun harness/local-site.ts [--port N]    serve this checkout until Ctrl-C (prints the address)
//
// What differs from a deploy (smoke.ts says so in its output): the build reads the main checkout's env file (as the
// dev server does) plus netlify.toml's [build.environment], not variables set in Netlify's UI; the YouTube function
// uses the local key; there is no CDN cache and no HTTPS, so HSTS is checked only as a header.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { loadEnv } from 'vite'

import { isRecord } from './bench/json'

// Pinned: a new netlify-cli can change what "as on Netlify" means
const NETLIFY_CLI = 'netlify-cli@27.14.2'
const READY_TIMEOUT_MS = 120_000
const FIRST_PORT = 8890
// The runtime's own output, for when it stops answering mid-run
// One log per run (by process), so two local sites never write over each other's
export const LOCAL_SITE_LOG = path.join(
  tmpdir(),
  `synbox-local-site-${process.pid}.log`
)

export interface LocalSite {
  url: string
  stop: () => void
}

// The main checkout, where the env file lives (a worktree has none of its own: vite.config.ts › envDir)
const mainCheckout = (dir: string) =>
  path.dirname(
    execFileSync(
      'git',
      ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf-8' }
    ).trim()
  )

// netlify.toml's [build.environment], which Netlify gives the build: the API addresses the deployed app calls
const buildEnvironment = (dir: string): Record<string, string> => {
  const toml: unknown = Bun.TOML.parse(
    readFileSync(path.join(dir, 'netlify.toml'), 'utf-8')
  )
  const build = isRecord(toml) ? toml.build : undefined
  const env = isRecord(build) ? build.environment : undefined
  return Object.fromEntries(
    Object.entries(isRecord(env) ? env : {}).map(([key, value]) => [
      key,
      String(value),
    ])
  )
}

// Free on one host: binding it works, then it's let go
const bindable = async (port: number, host?: string) => {
  const { promise, resolve } = Promise.withResolvers<boolean>()
  const server = createServer()
  server.once('error', () => {
    resolve(false)
  })
  server.listen(port, host, () => {
    server.close(() => {
      resolve(true)
    })
  })
  return await promise
}

// Free on every address and on each loopback one, tried one by one: netlify-cli binds 127.0.0.1 and ::1 separately,
// a proxy binds the wildcard, and any one of these binds can succeed beside a process holding another, so a second local site (another agent's) took a port
// the first held on ::1 and its requests went to the other site
const freePort = async (from: number): Promise<number> => {
  for (let port = from; port < from + 100; port += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one port at a time, the first free one wins
    const hosts = await Promise.all([
      bindable(port),
      bindable(port, '127.0.0.1'),
      bindable(port, '::1'),
    ])
    const free = hosts.every(Boolean)
    if (free) {
      return port
    }
  }
  throw new Error(`no free port from ${from}`)
}

/** Builds `dir` for production and serves it with Netlify's local runtime; resolves once it answers */
export const serveLocalSite = async (
  dir: string,
  port?: number
): Promise<LocalSite> => {
  const env = loadEnv('production', mainCheckout(dir), '')
  const { SENTRY_AUTH_TOKEN: _upload, ...shell } = process.env
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: dir,
    // Never uploads source maps from here (vite.config.ts uploads only when SENTRY_AUTH_TOKEN is set)
    env: { ...shell, ...buildEnvironment(dir) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (build.status !== 0) {
    throw new Error(
      `local build failed: ${String(build.stderr).trim().slice(-600) || String(build.stdout).trim().slice(-600)}`
    )
  }
  // A copy of what Netlify deploys (the build, the functions, netlify.toml), outside ~/github-workspace: netlify-cli
  // looks for the project root upward and stops at any package.json, and a stray one above the checkouts made it
  // serve that folder, with no Edge Function
  const site = mkdtempSync(path.join(tmpdir(), 'synbox-local-site-'))
  for (const part of ['dist', 'netlify', 'netlify.toml', 'package.json']) {
    cpSync(path.join(dir, part), path.join(site, part), { recursive: true })
  }
  symlinkSync(path.join(dir, 'node_modules'), path.join(site, 'node_modules'))
  const chosen = port ?? (await freePort(FIRST_PORT))
  // Its own ports for the runtime, its static server and the functions too, so two runs (or another session's)
  // never collide
  const runtimePort = await freePort(chosen + 1)
  const staticPort = await freePort(runtimePort + 1)
  const functionsPort = await freePort(staticPort + 1)
  const child = spawn(
    'bunx',
    [
      NETLIFY_CLI,
      'dev',
      '--dir',
      'dist',
      '--framework',
      '#static',
      '--port',
      String(runtimePort),
      '--staticServerPort',
      String(staticPort),
      '--functions-port',
      String(functionsPort),
      '--no-open',
      '--skip-gitignore',
    ],
    {
      cwd: site,
      detached: true,
      // The YouTube function's key, as the dev server passes it (vite.config.ts › serveYoutube); never printed
      env: {
        ...shell,
        BROWSER: 'none',
        YOUTUBE_API_KEY: env.YOUTUBE_API_KEY ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  const front: { server?: ReturnType<typeof Bun.serve> } = {}
  const stop = () => {
    void front.server?.stop(true)
    if (child.pid !== undefined) {
      try {
        // The whole group: netlify-cli runs its static server, functions and Deno as children
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
    rmSync(site, { force: true, recursive: true })
  }
  // The runtime runs in its own process group (so stop() ends all of it), which a dying parent wouldn't take down
  process.once('exit', stop)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      stop()
      process.exit(1)
    })
  }
  writeFileSync(LOCAL_SITE_LOG, '')
  let output = ''
  const started = Promise.withResolvers<boolean>()
  const timer = setTimeout(() => {
    started.resolve(false)
  }, READY_TIMEOUT_MS)
  const read = (chunk: Buffer) => {
    appendFileSync(LOCAL_SITE_LOG, chunk)
    output = `${output}${String(chunk)}`.slice(-4000)
    if (
      output.includes(`localhost:${runtimePort}`) &&
      output.includes('ready')
    ) {
      started.resolve(true)
    }
  }
  child.stdout.on('data', read)
  child.stderr.on('data', read)
  child.once('exit', () => {
    started.resolve(false)
  })
  const ready = await started.promise
  clearTimeout(timer)
  if (!ready) {
    stop()
    throw new Error(
      `Netlify's local runtime didn't start on port ${runtimePort}: ${output.slice(-600)}`
    )
  }
  // In front of the runtime: netlify-cli 27 exits ("Error: aborted") when a browser drops a request it is still
  // answering, which a page navigating away does all the time. Here a dropped request is finished upstream and
  // thrown away, so the runtime never sees the abort. Bytes pass through as they are (no decompression)
  front.server = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url)
      const headers = new Headers(request.headers)
      headers.delete('connection')
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
      return await fetch(
        `http://localhost:${runtimePort}${url.pathname}${url.search}`,
        {
          body: hasBody ? await request.arrayBuffer() : undefined,
          decompress: false,
          headers,
          method: request.method,
          redirect: 'manual',
        }
      )
    },
    idleTimeout: 120,
    port: chosen,
  })
  return { stop, url: `http://localhost:${chosen}` }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { port: { type: 'string' } } })
  const site = await serveLocalSite(
    process.cwd(),
    values.port === undefined ? undefined : Number(values.port)
  )
  console.log(`local site: ${site.url} (Ctrl-C stops it)`)
}
