// Serves a bench build the way Netlify serves production: compressed text, the same cache headers, the same
// /api proxies, and an SPA fallback. API responses are recorded once and replayed after, so every run (and both
// sides of a comparison) sees the same data: the bench measures the frontend, not the backend's weather.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

import { backendOrigins, benchOrigins, replayedGet } from './replay'

export type ApiMode = 'replay' | 'live'

interface Proxy {
  from: string
  to: string
}

const tomlBlocks = (toml: string, table: string): Record<string, string>[] =>
  toml
    .split(/^\[\[|^\[/mu)
    .filter((block) => block.startsWith(`${table}]`))
    .map((block) =>
      Object.fromEntries(
        [...block.matchAll(/^(?<key>\w+)\s*=\s*"(?<value>[^"]*)"/gmu)].map(
          (m) => [m[1], m[2]]
        )
      )
    )

/** Proxies exactly as netlify.toml declares them, plus the two routes Netlify answers itself and the two services the
 * site calls directly */
export const proxiesFrom = (repoTop: string): Proxy[] => {
  const toml = readFileSync(path.join(repoTop, 'netlify.toml'), 'utf-8')
  const declared = tomlBlocks(toml, 'redirects')
    .filter((r) => r.to?.startsWith('https://'))
    .map((r) => ({ from: r.from, to: r.to }))
  const { lookup, api } = backendOrigins(repoTop)
  return [
    ...declared,
    // netlify/functions/youtube.ts answers this path in production
    { from: '/api/youtube/*', to: 'https://synbox.io/api/youtube/:splat' },
    // netlify/functions/library-songs.ts answers this one, from the lookup service; recorded under that address
    { from: '/api/library/songs', to: `${lookup}/library/songs` },
    // Bench builds point the lookup service here (VITE_SYNBOX_LOOKUP_URL=/__lookup), so its reads replay too
    { from: '/__lookup/*', to: `${lookup}/:splat` },
    // And the Worker the site reads lyrics and karaoke timing from (VITE_SYNBOX_API_URL=/__api)
    { from: '/__api/*', to: `${api}/:splat` },
  ]
}

const target = (proxies: Proxy[], pathname: string): string | null => {
  for (const p of proxies) {
    if (p.from.endsWith('/*')) {
      const prefix = p.from.slice(0, -1)
      if (pathname.startsWith(prefix)) {
        return p.to.replace(':splat', pathname.slice(prefix.length))
      }
    } else if (pathname === p.from) {
      return p.to
    }
  }
  return null
}

const TEXT =
  /^(?:text\/|application\/(?:javascript|json|manifest\+json|xml)|image\/svg)/u
const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

const cacheControl = (pathname: string): string =>
  /^\/assets\/.+\.(?:js|css)$/u.test(pathname)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate'

// Netlify compresses function and proxy responses too; serving them raw would overstate transfer on slow 4G
const respond = (
  req: Request,
  body: string,
  contentType: string,
  status: number
): Response => {
  const accept = req.headers.get('accept-encoding') ?? ''
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'content-type': contentType,
  }
  if (accept.includes('br') && TEXT.test(contentType) && body.length > 1024) {
    return new Response(new Uint8Array(brotliCompressSync(body)), {
      headers: { ...headers, 'content-encoding': 'br' },
      status,
    })
  }
  return new Response(body, { headers, status })
}

export interface BenchServer {
  origin: string
  stop: () => void
  /** API requests answered so far, by how (replayed, recorded, live) */
  counts: Record<string, number>
}

// Compressed files, shared by every server this process starts. Compressing a build takes over a second of
// synchronous work; done on demand, the first page load after each server start paid it and read as a slow run
const compressed = new Map<string, Buffer>()

const compressedFile = (file: string, encoding: 'br' | 'gzip'): Buffer => {
  const key = `${encoding}:${file}`
  let body = compressed.get(key)
  if (body === undefined) {
    const raw = readFileSync(file)
    body = encoding === 'br' ? brotliCompressSync(raw) : gzipSync(raw)
    compressed.set(key, body)
  }
  return body
}

const precompress = (dir: string): void => {
  for (const name of readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, String(name))
    if (
      statSync(file).isFile() &&
      TEXT.test(TYPES[path.extname(file)] ?? '') &&
      !file.endsWith('.map')
    ) {
      compressedFile(file, 'br')
    }
  }
}

export const serveBuild = (opts: {
  distDir: string
  repoTop: string
  fixturesDir: string
  mode: ApiMode
  port?: number
}): BenchServer => {
  const proxies = proxiesFrom(opts.repoTop)
  precompress(opts.distDir)
  const counts: Record<string, number> = {
    absorbed: 0,
    live: 0,
    recorded: 0,
    replayed: 0,
  }

  const api = async (req: Request, upstream: string): Promise<Response> => {
    // A bench run never writes to production: every listen it played went to the real Worker, and one test song
    // showed 1,914 listens (2026-10-24). The app ignores what a write answers, so an empty success does
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      counts.absorbed += 1
      return new Response(null, { status: 204 })
    }
    if (opts.mode === 'replay' && req.method === 'GET') {
      const { answer, how } = await replayedGet(
        opts.fixturesDir,
        upstream,
        req.headers.get('accept')
      )
      counts[how] += 1
      return respond(req, answer.body, answer.contentType, answer.status)
    }
    const res = await fetch(upstream, {
      // The YouTube function passes the page's referrer on to Google; give it the production one
      headers: {
        accept: req.headers.get('accept') ?? '*/*',
        referer: 'https://synbox.io/',
      },
      method: req.method,
    })
    counts.live += 1
    return respond(
      req,
      await res.text(),
      res.headers.get('content-type') ?? 'application/octet-stream',
      res.status
    )
  }

  const file = (req: Request, requested: string): Response => {
    let pathname = requested
    let resolved = path.join(opts.distDir, pathname)
    if (
      !resolved.startsWith(opts.distDir) ||
      !existsSync(resolved) ||
      statSync(resolved).isDirectory()
    ) {
      resolved = path.join(opts.distDir, 'index.html')
      pathname = '/index.html'
    }
    const type = TYPES[path.extname(resolved)] ?? 'application/octet-stream'
    const headers: Record<string, string> = {
      'cache-control':
        pathname === '/sw.js' ? 'no-cache' : cacheControl(pathname),
      'content-type': type,
    }
    const accept = req.headers.get('accept-encoding') ?? ''
    let encoding: 'br' | 'gzip' | null = null
    if (accept.includes('br')) {
      encoding = 'br'
    } else if (accept.includes('gzip')) {
      encoding = 'gzip'
    }
    if (encoding !== null && TEXT.test(type)) {
      const body = compressedFile(resolved, encoding)
      return new Response(new Uint8Array(body), {
        headers: { ...headers, 'content-encoding': encoding },
      })
    }
    return new Response(new Uint8Array(readFileSync(resolved)), { headers })
  }

  const server = Bun.serve({
    async fetch(req) {
      const url = new URL(req.url)
      const upstream = target(proxies, url.pathname)
      if (upstream !== null) {
        return await api(req, upstream + url.search)
      }
      return file(req, decodeURIComponent(url.pathname))
    },
    port: opts.port ?? 0,
  })
  const origin = `http://localhost:${server.port}`
  benchOrigins.add(origin)
  return {
    counts,
    origin,
    stop: () => {
      benchOrigins.delete(origin)
      void server.stop(true)
    },
  }
}
