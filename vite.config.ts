import type { IncomingMessage, ServerResponse } from 'node:http'

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

import { handleYoutube } from './netlify/youtube-proxy'

// The dev server's stand-in for the Netlify function at /api/youtube
const serveYoutube = async (
  // Connect strips the mount path from url and keeps the full one here
  req: IncomingMessage & { originalUrl?: string },
  res: ServerResponse,
  next: (error?: unknown) => void
) => {
  const { referer } = req.headers
  const headers = new Headers(referer === undefined ? {} : { referer })
  const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '')
  // A local .env from before the proxy still works: its referrer-restricted browser key accepts the
  // localhost page the request came from
  const key = env.YOUTUBE_API_KEY || env.VITE_GOOGLE_API_KEY
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
    next(error)
  }
}

export default defineConfig({
  fmt: {
    ...ultraciteFmt,
    bracketSameLine: true,
    ignorePatterns: [...(ultraciteFmt.ignorePatterns ?? []), '.upgrade-log/**'],
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
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
  },
  // Netlify's commit for the build, shown in the profile menu so a tester can tell which one is running
  define: {
    __BUILD_ID__: JSON.stringify(
      (process.env.COMMIT_REF ?? 'local').slice(0, 7)
    ),
  },
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
    },
    // Maps go to Sentry, not to the deployed site
    sourcemap: 'hidden',
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
      // UpdatePrompt asks before swapping in a new deploy, so a playing song is never reloaded
      injectRegister: false,
      manifest: {
        background_color: '#1f0a15',
        categories: ['music', 'entertainment'],
        description:
          'Japanese karaoke for any YouTube video, with AI-transcribed, synced lyrics, furigana, romaji and translations.',
        display: 'standalone',
        icons: [
          { sizes: '64x64', src: 'pwa-64x64.png', type: 'image/png' },
          { sizes: '192x192', src: 'pwa-192x192.png', type: 'image/png' },
          { sizes: '512x512', src: 'pwa-512x512.png', type: 'image/png' },
          {
            purpose: 'maskable',
            sizes: '512x512',
            src: 'maskable-icon-512x512.png',
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
        theme_color: '#1f0a15',
      },
      registerType: 'prompt',
      workbox: {
        cleanupOutdatedCaches: true,
        // The app shell only. Lyrics, songs and videos always come from the network
        globIgnores: [
          'AppLogoV2.svg',
          'assets/icons/Synbox.svg',
          'assets/showcase/**',
        ],
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//u],
        runtimeCaching: [
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
        ],
        sourcemap: false,
      },
    }),
    // Uploads source maps when SENTRY_AUTH_TOKEN is set (the Netlify build)
    sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: (process.env.SENTRY_AUTH_TOKEN ?? '') === '',
      org: 'edward-ve',
      project: 'synbox-frontend',
      release: { name: process.env.COMMIT_REF },
      sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] },
      telemetry: false,
    }),
  ]),
  resolve: {
    alias: {
      '@': `${import.meta.dirname}/src`,
    },
  },
})
