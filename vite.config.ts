import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import jotai from 'jotai-rolldown'
import ultraciteFmt from 'ultracite/oxfmt'
import core from 'ultracite/oxlint/core'
import ultraciteReact from 'ultracite/oxlint/react'
import shadcn from 'ultracite/oxlint/shadcn'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, lazyPlugins, loadEnv } from 'vite-plus'

import { handleLyrics } from './dev/lyrics-proxy'
import { handleYoutube } from './netlify/youtube-proxy'

// A git worktree has no env file of its own, so every checkout reads the main checkout's
const envDir = (() => {
  try {
    const gitDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: import.meta.dirname, encoding: 'utf-8' }
    )
    return path.dirname(gitDir.trim())
  } catch {
    return import.meta.dirname
  }
})()

// The dev and preview servers' stand-in for the Worker's lyrics routes (dev/lyrics-proxy.ts)
const serveLyrics = async (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void
) => {
  if (!/^\/api\/(?:lyrics|lyrics-dates|karaoke)\b/u.test(req.url ?? '')) {
    // oxlint-disable-next-line node/callback-return -- Connect's next() passes the request on
    next()
    return
  }
  try {
    const env = loadEnv(process.env.NODE_ENV ?? 'development', envDir, '')
    const response = await handleLyrics(
      new Request(new URL(req.url ?? '', 'http://localhost')),
      env
    )
    if (response === null) {
      // oxlint-disable-next-line node/callback-return -- as above
      next()
      return
    }
    res.statusCode = response.status
    res.setHeader('Content-Type', 'application/json')
    res.end(await response.text())
  } catch (error) {
    // oxlint-disable-next-line node/callback-return -- Connect's next() ends the request
    next(error)
  }
}

// The dev server's stand-in for the Netlify function at /api/youtube
const serveYoutube = async (
  // Connect strips the mount path from url and keeps the full one here
  req: IncomingMessage & { originalUrl?: string },
  res: ServerResponse,
  next: (error?: unknown) => void
) => {
  const { referer } = req.headers
  const headers = new Headers(referer === undefined ? {} : { referer })
  const env = loadEnv(process.env.NODE_ENV ?? 'development', envDir, '')
  const key = env.YOUTUBE_API_KEY
  try {
    const response = await handleYoutube(
      new Request(new URL(req.originalUrl ?? '', 'http://localhost'), {
        headers,
      }),
      key
    )
    res.statusCode = response.status
    for (const [name, value] of response.headers) {
      res.setHeader(name, value)
    }
    res.end(await response.text())
  } catch (error) {
    // oxlint-disable-next-line node/callback-return -- Connect's next() ends the request; returning its void result breaks no-confusing-void-expression
    next(error)
  }
}

// Maps exist only for Sentry, which deletes them after its upload. Without its token nothing would delete them
const uploadsSourcemaps = (process.env.SENTRY_AUTH_TOKEN ?? '') !== ''
let outDir = 'dist'

const LIBRARY_SONGS_PROXY = {
  changeOrigin: true,
  rewrite: () => '/library/songs',
  target: 'https://synbox-lookup-1045990822048.asia-southeast1.run.app',
}

// The Content-Security-Policy (netlify.toml) allows no eval. Zod would compile its object parsers with
// `new Function`, and its probe for that is reported as a violation even though it is caught. Zod reads its
// config from this global, so setting it at the top of every chunk turns that off before any schema parses:
// an import can't, since a chunk's modules run before the entry's own code
const ZOD_JITLESS = '(globalThis.__zod_globalConfig ??= {}).jitless = true;'

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      onLog(level, log, handler) {
        if (
          log.cause instanceof Error &&
          log.cause.message === `Can't resolve original location of error.`
        ) {
          return
        }
        handler(level, log)
      },
      output: { banner: ZOD_JITLESS },
    },
    // Maps go to Sentry, not to the deployed site
    sourcemap: uploadsSourcemaps ? 'hidden' : false,
  },
  // Netlify's commit for the build, shown in the profile menu so a tester can tell which one is running
  define: {
    __BUILD_ID__: JSON.stringify(
      (process.env.COMMIT_REF ?? 'local').slice(0, 7)
    ),
  },
  envDir,
  fmt: {
    ...ultraciteFmt,
    bracketSameLine: true,
    // The change log is hand-written prose that agents grep and append to; reflowing it would churn every entry
    ignorePatterns: [
      ...(ultraciteFmt.ignorePatterns ?? []),
      '.upgrade-log/**',
      'docs/log/**',
    ],
    jsxSingleQuote: true,
    semi: false,
    singleQuote: true,
    sortTailwindcss: {
      ...(typeof ultraciteFmt.sortTailwindcss === 'object'
        ? ultraciteFmt.sortTailwindcss
        : {}),
      stylesheet: './src/globals.css',
    },
  },
  lint: {
    env: core.env,
    extends: [core, ultraciteReact, shadcn],
    ignorePatterns: [...(core.ignorePatterns ?? []), '.upgrade-log/**'],
    jsPlugins: [
      ...(shadcn.jsPlugins ?? []),
      { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
    ],
    options: { typeAware: true, typeCheck: true },
    rules: {
      // React 19's types require useRef's initial value, so `useRef<T | undefined>(undefined)` must pass it
      'unicorn/no-useless-undefined': ['error', { checkArguments: false }],
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
  },
  plugins: lazyPlugins(() => [
    // Without it the built site sends every backend call to its own host
    {
      apply: 'build',
      configResolved({ env }) {
        const url: unknown = env.VITE_SYNBOX_BE_URL
        if (typeof url !== 'string' || url === '') {
          throw new Error('VITE_SYNBOX_BE_URL must be set to build the site')
        }
      },
      name: 'require-backend-url',
    },
    // The auth Worker serves lyrics and karaoke timing (worker/src/lyrics.ts); locally a stand-in answers the same
    // paths, so a dev server or a preview build shows lyrics without a Worker running
    {
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          void serveLyrics(req, res, next)
        })
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          void serveLyrics(req, res, next)
        })
      },
      name: 'lyrics-proxy',
    },
    // Netlify serves /api/youtube from a function; the dev server answers with the same handler
    {
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/api/youtube', (req, res, next) => {
          void serveYoutube(req, res, next)
        })
      },
      name: 'youtube-proxy',
    },
    tailwindcss(),
    react(),
    jotai(),
    VitePWA({
      // src/lib/pwa.ts swaps a new deploy in only where a reload goes unnoticed, never during a song
      injectRegister: false,
      manifest: {
        background_color: '#0e0c0c',
        categories: ['music', 'entertainment'],
        description:
          'Japanese karaoke for any YouTube video, with AI-transcribed, synced lyrics, furigana, romaji and translations.',
        display: 'standalone',
        icons: [
          { sizes: '64x64', src: 'pwa-64x64-e0e4e24d.png', type: 'image/png' },
          {
            sizes: '192x192',
            src: 'pwa-192x192-f591e4ca.png',
            type: 'image/png',
          },
          {
            sizes: '512x512',
            src: 'pwa-512x512-51f10054.png',
            type: 'image/png',
          },
          {
            purpose: 'maskable',
            sizes: '512x512',
            src: 'maskable-icon-512x512-31cb5bbb.png',
            type: 'image/png',
          },
        ],
        id: '/',
        name: 'Synbox Karaoke',
        orientation: 'any',
        scope: '/',
        // Android's install sheet shows these; the narrow pair on phones, the wide one on desktop
        screenshots: [
          {
            form_factor: 'narrow',
            label:
              'Lyrics with furigana, romaji and a translation under the video',
            sizes: '780x1688',
            src: 'screenshots/narrow-player.jpg',
            type: 'image/jpeg',
          },
          {
            form_factor: 'narrow',
            label: 'Search or paste a YouTube link to start',
            sizes: '780x1688',
            src: 'screenshots/narrow-home.jpg',
            type: 'image/jpeg',
          },
          {
            form_factor: 'wide',
            label: 'Karaoke lyrics over the music video',
            sizes: '1920x1080',
            src: 'screenshots/wide-player.jpg',
            type: 'image/jpeg',
          },
        ],
        short_name: 'Synbox',
        start_url: '/',
        theme_color: '#0e0c0c',
      },
      registerType: 'prompt',
      workbox: {
        cleanupOutdatedCaches: true,
        // Or the precache would still answer "/" with its index.html, ahead of the pages route below
        directoryIndex: '',
        // The app shell only. Lyrics, songs and videos always come from the network
        // The logo's 270KB source SVG (scripts/pwa-icons.ts draws the icons from it); the app shows the WebP
        globIgnores: ['assets/icons/Synbox_logo_dark_1.svg'],
        globPatterns: ['**/*.{js,css,html,png,svg,webp,woff2}'],
        // Pages from the network, so opening or reloading a tab shows the latest deploy (a precached page kept
        // the deploy the worker was built with until a hard reload). Offline, the shell in the precache answers:
        // it names the scripts precached beside it. Never a saved copy of an earlier page, which names scripts a
        // later deploy deleted (the app opened to a blank screen)
        navigateFallback: null,
        runtimeCaching: [
          {
            handler: 'NetworkOnly',
            options: {
              precacheFallback: { fallbackURL: '/index.html' },
            },
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
          },
          {
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com',
          },
          {
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 60 },
            },
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
          },
          {
            // Account pictures, kept so pages and app launches show them without asking Google again, which
            // refuses repeated requests, and offline. Only real pictures: the requests are CORS (user-avatar.tsx),
            // so an error is visible and never stored
            handler: 'CacheFirst',
            options: {
              cacheName: 'avatars',
              cacheableResponse: { statuses: [200] },
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 4 },
            },
            urlPattern: ({ url }) =>
              url.origin === 'https://lh3.googleusercontent.com',
          },
        ],
        sourcemap: false,
      },
    }),
    // Uploads source maps when SENTRY_AUTH_TOKEN is set (the Netlify build)
    sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !uploadsSourcemaps,
      org: 'edward-ve',
      project: 'synbox-frontend',
      release: { name: process.env.COMMIT_REF },
      sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] },
      telemetry: false,
    }),
    // Fails the build if a map is still in the output after Sentry's upload, so it never deploys
    {
      apply: 'build',
      closeBundle: {
        handler() {
          const left = readdirSync(outDir, { recursive: true }).filter((file) =>
            String(file).endsWith('.map')
          )
          if (left.length > 0) {
            throw new Error(
              `Source maps left in the build, which would deploy: ${left.join(', ')}`
            )
          }
        },
        order: 'post',
        sequential: true,
      },
      configResolved(config) {
        outDir = path.resolve(config.root, config.build.outDir)
      },
      name: 'no-shipped-sourcemaps',
    },
  ]),
  // The gallery's song list, straight from the lookup service (deployed, netlify/functions/library-songs.ts)
  preview: { proxy: { '/api/library/songs': LIBRARY_SONGS_PROXY } },
  resolve: {
    alias: {
      '@': `${import.meta.dirname}/src`,
    },
  },
  // Netlify sends these to the auth Worker; locally that is `wrangler dev --env dev` in worker/. The gallery's
  // song list goes straight to the lookup service
  server: {
    proxy: {
      '/api/admin': 'http://localhost:8787',
      '/api/auth': 'http://localhost:8787',
      '/api/library/songs': LIBRARY_SONGS_PROXY,
      '/api/me': 'http://localhost:8787',
      '/api/recommendations': 'http://localhost:8787',
      '/api/reports': 'http://localhost:8787',
      '/api/songs': 'http://localhost:8787',
    },
  },
  // worker/ has its own tests, run with bun test there
  test: {
    exclude: ['**/node_modules/**', 'worker/**'],
  },
})
