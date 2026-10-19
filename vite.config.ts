import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import jotai from 'jotai-rolldown'
import ultraciteFmt from 'ultracite/oxfmt'
import core from 'ultracite/oxlint/core'
import ultraciteReact from 'ultracite/oxlint/react'
import shadcn from 'ultracite/oxlint/shadcn'
import { defineConfig, lazyPlugins } from 'vite-plus'

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
    tailwindcss(),
    react(),
    jotai(),
    // Uploads source maps when SENTRY_AUTH_TOKEN is set (the Netlify build)
    sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
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
