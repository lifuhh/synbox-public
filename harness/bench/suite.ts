// What the bench measures. Exact benchmarks (size, layout-*) run in `check` against harness/budgets.json; timing
// benchmarks run in `trend`, where each metric says whether it gates and how big a change matters. Specs are the
// evaluator's: changing them in the same branch as app code fails `check` (gate.ts).

import { cdpPerf } from './engines/cdp'
import { homeVisit } from './probes/home'
import { layoutAudit, layoutPages } from './probes/layout'
import type { LayoutPage } from './probes/layout'
import { playerSession } from './probes/player'
import { buildSize } from './probes/size'
import type { Benchmark, MetricSpec, Surface } from './types'

const ms = (key: string, gate = true, floor = 30, pct = 0.1): MetricSpec => ({
  better: 'lower',
  floor,
  gate,
  key,
  pct,
  unit: 'ms',
})
const loadMs = (key: string, gate = true) => ms(key, gate, 50, 0.05)
const fps = (key: string, gate = true): MetricSpec => ({
  better: 'higher',
  floor: 3,
  gate,
  key,
  pct: 0.05,
  unit: 'fps',
})
const ratio = (key: string, gate = true): MetricSpec => ({
  better: 'lower',
  floor: 0.03,
  gate,
  key,
  pct: 0,
  unit: 'ratio',
})
const cls = (gate = true): MetricSpec => ({
  better: 'lower',
  floor: 0.01,
  gate,
  key: 'cls',
  pct: 0,
  unit: 'cls',
})
const kb = (key: string): MetricSpec => ({
  better: 'lower',
  exact: true,
  floor: 0.5,
  gate: true,
  key,
  pct: 0.01,
  unit: 'kb',
})
const count = (key: string, gate = true): MetricSpec => ({
  better: 'lower',
  exact: true,
  floor: 1,
  gate,
  key,
  pct: 0,
  unit: 'count',
})

const DESKTOP: Surface = { engine: 'chromium', kind: 'desktop' }
const PORTRAIT: Surface = {
  engine: 'webkit',
  kind: 'phone',
  orientation: 'portrait',
}
const LANDSCAPE: Surface = {
  engine: 'webkit',
  kind: 'phone',
  orientation: 'landscape',
}
const INSTALLED: Surface = { ...PORTRAIT, installed: true }
const BUSY_PAGES = new Set(['home', 'gallery', 'player', 'search'])

/**
 * Lighthouse's mobile lab: a mid-range phone on slow 4G, where load regressions show first. The service worker is
 * blocked: on a first visit it only installs after load, but its 1.9 MB precache over slow 4G kept the network busy
 * for over a minute per run without changing a single load metric.
 */
const MOBILE_LAB = [
  '--mobile',
  '--cpu',
  '4',
  '--net',
  'slow4g',
  '--settle',
  '2000',
  '--block',
  '*://localhost:*/sw.js',
]

const cdpLoad = (
  path: string,
  pick: Record<string, string>,
  flags = MOBILE_LAB
): Pick<Benchmark, 'run'> => ({
  run: async (ctx, runs) => ({
    errors: [],
    samples: await cdpPerf(ctx, { flags, path, pick, runs }),
  }),
})

const player = (videoId: string): Benchmark => ({
  id: `player-${videoId}`,
  metrics: [
    ms('iframeMs'),
    ms('readyMs', true, 100),
    ms('lyricsDataMs', true, 100),
    ms('firstLineMs', false, 200),
    ms('playingMs', true, 100),
    ms('pauseMs', true, 50, 0.2),
    ms('resumeMs', true, 50, 0.2),
    ms('seekMs', true, 100, 0.2),
    fps('playbackFps'),
    ratio('playbackDroppedRatio'),
    ms('playbackP95FrameMs', false, 4),
    { ...count('lyricLines', false), exact: false },
    { ...cls(false) },
    loadMs('lcpMs', false),
  ],
  run: playerSession(videoId),
  runs: 12,
  surface: DESKTOP,
  title: `Player session for ${videoId}: iframe, ready, lyrics, autoplay, pause, resume, seek, playback frames`,
})

const layout = (
  page: LayoutPage,
  surface: Surface,
  name: string
): Benchmark => ({
  id: `layout-${page.name}-${name}`,
  metrics: [
    count('overflowXPx'),
    count('occludedTargets'),
    count('smallTargets'),
    count('offscreenTargets'),
    count('unsafeTargets'),
    count('pageErrors'),
    count('targets', false),
  ],
  run: layoutAudit(page, surface),
  runs: 1,
  surface,
  title: `Layout of ${page.name} (${page.path}) on ${name}: target sizes, covered targets, overflow, safe areas, page errors`,
})

const cdpFlow = (
  flow: { name: string; path: string; steps: object[] },
  flags: string[],
  pick: Record<string, string>
): Pick<Benchmark, 'run'> => ({
  run: async (ctx, runs) => ({
    errors: [],
    samples: await cdpPerf(ctx, {
      flags,
      flow: { name: flow.name, stepSettleMs: 500, steps: flow.steps },
      path: flow.path,
      pick,
      runs,
    }),
  }),
})

const HERO_BOX = '[data-bench=hero-input]'
const HERO_TYPE = {
  name: 'hero-type',
  path: '/',
  steps: [
    { action: 'waitFor', name: 'box', selector: HERO_BOX },
    { action: 'type', name: 'query', selector: HERO_BOX, text: 'yoasobi idol' },
  ],
}

export const SUITE: Benchmark[] = [
  {
    id: 'size',
    metrics: [kb('initialJsKB'), kb('cssKB'), kb('allJsKB')],
    run: buildSize,
    runs: 1,
    surface: null,
    title: 'Bytes shipped (brotli): first-load JS and CSS, all JS',
  },
  {
    id: 'home',
    metrics: [
      loadMs('fcpMs'),
      // On this desktop run the largest paint is the first one; gating both would double-count one number
      loadMs('lcpMs', false),
      cls(),
      ms('heroInputMs'),
      ms('interactiveMs'),
      ms('carouselMs', true, 50),
      ms('chartsMs', true, 50),
      // Both chart pages arrive before the first row renders today; reported until they come apart
      ms('chartsDoneMs', false, 50),
      { ...count('chartsRows', false), exact: false },
      ms('galleryMs', true, 50),
      ms('carouselNextMs', true, 50, 0.15),
      fps('carouselNextFps', false),
      fps('galleryFps'),
      ratio('galleryDroppedRatio'),
      ratio('galleryBlankRatio'),
      ms('galleryP95FrameMs', false, 4),
      ms('galleryScrollBlockingMs', true, 30, 0.25),
    ],
    run: homeVisit,
    runs: 12,
    surface: DESKTOP,
    title:
      'Home visit (desktop, 4× CPU): paint, first input, carousel, charts, gallery, Next press, gallery scroll',
  },
  {
    id: 'home-load',
    metrics: [
      loadMs('fcpMs'),
      loadMs('lcpMs'),
      cls(),
      ms('tbtMs', true, 30, 0.15),
      loadMs('ttiMs', false),
      ms('scriptMs', false),
      { ...kb('transferKB'), exact: false, gate: false },
    ],
    ...cdpLoad('/', {
      cls: 'load.cls',
      fcpMs: 'load.fcpMs',
      lcpMs: 'load.lcpMs',
      scriptMs: 'load.scriptMs',
      tbtMs: 'load.tbtMs',
      transferKB: 'load.transferKB',
      ttiMs: 'load.ttiMs',
    }),
    runs: 12,
    surface: null,
    title:
      'Home page load, mobile lab (cdp-perf: 4× CPU, slow 4G, 412px phone)',
  },
  player('6rG_irmOQsM'),
  // Every route in src/app.tsx, so a new page is audited without anyone adding it. Phones on their side matter
  // most where the layout is busiest
  ...layoutPages().flatMap((page) => [
    layout(page, DESKTOP, 'desktop'),
    layout(page, PORTRAIT, 'phone'),
    layout(page, INSTALLED, 'installed'),
    ...(BUSY_PAGES.has(page.name)
      ? [layout(page, LANDSCAPE, 'phone-landscape')]
      : []),
  ]),
  player('x1FV6IrjZCY'),
  player('ZRtdQ81jPUQ'),
  {
    id: 'player-load',
    metrics: [
      loadMs('fcpMs'),
      loadMs('lcpMs'),
      cls(),
      ms('tbtMs', true, 30, 0.15),
    ],
    ...cdpLoad('/v/6rG_irmOQsM', {
      cls: 'load.cls',
      fcpMs: 'load.fcpMs',
      lcpMs: 'load.lcpMs',
      tbtMs: 'load.tbtMs',
    }),
    runs: 12,
    surface: null,
    title: 'Player page load, mobile lab (cdp-perf)',
  },
  {
    id: 'hero-type',
    metrics: [
      ms('flowInpMs', true, 16, 0.2),
      ms('flowBlockingMs', true, 30, 0.25),
    ],
    ...cdpFlow(HERO_TYPE, ['--cpu', '4', '--settle', '1000'], {
      flowBlockingMs: 'flow.blockingMs',
      flowInpMs: 'flow.inpMs',
    }),
    runs: 12,
    surface: null,
    title:
      'Typing in the hero box (cdp-perf flow, 4× CPU): interaction latency and blocking',
  },
  player('Dta27KjGpJs'),
]
