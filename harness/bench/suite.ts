// What the bench measures. Exact benchmarks (size, layout-*) run in `check` against harness/budgets.json; timing
// benchmarks run in `trend`, where each metric says whether it gates and how big a change matters. Specs are the
// evaluator's: changing them in the same branch as app code fails `check` (gate.ts).

import {
  ALL_VIEWS,
  PWA_LANDSCAPE,
  PWA_PORTRAIT,
  SAFARI_LANDSCAPE,
  SAFARI_NARROW,
  SAFARI_PORTRAIT,
  WEB,
} from './engines/browser'
import type { View } from './engines/browser'
import { cdpPerf } from './engines/cdp'
import { controlShadeAudit } from './probes/control-shade'
import { homeVisit } from './probes/home'
import { landscapeParityAudit } from './probes/landscape-parity'
import { LAYOUT_FINDINGS, layoutAudit, layoutPages } from './probes/layout'
import type { LayoutPage, OpenedState } from './probes/layout'
import { lyricDockAudit } from './probes/lyric-dock'
import { lyricShiftAudit } from './probes/lyric-shift'
import { playerSession } from './probes/player'
import {
  PRESS_RELEASE_FINDINGS,
  pressReleaseAudit,
} from './probes/press-release'
import { buildSize } from './probes/size'
import type { Benchmark, MetricSpec } from './types'

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

const DESKTOP = WEB.surface
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
  { label, name, surface }: View,
  state?: OpenedState
): Benchmark => ({
  id: `layout-${page.name}-${name}${state ? `+${state.name}` : ''}`,
  metrics: [
    ...LAYOUT_FINDINGS.map((key) => count(key)),
    count('targets', false),
    count('pressTested', false),
  ],
  run: layoutAudit(page, surface, state),
  runs: 1,
  surface,
  title: `Layout of ${page.name} (${page.path})${state ? ` with ${state.name} open` : ''} in ${name} (${label}): target sizes, covered targets, overflow, safe areas, painted insets, pan, zooming fields, clipped text, page and console errors`,
})

/**
 * Two Lines on the player, played: how often a line change moves what should stay (probes/lyric-shift.ts). On the
 * installed app on its side, and upright turned by Lock Landscape (the iPhone's way to its side)
 */
const lyricShift = (name: string, view: View, turned: boolean): Benchmark => ({
  id: `lyric-shift-${name}`,
  metrics: [
    count('otherLineMoves'),
    count('lowerRomajiMoves'),
    count('dockedTranslationMoves'),
    count('lineChanges', false),
  ],
  run: lyricShiftAudit(view.surface, turned),
  runs: 1,
  surface: view.surface,
  title: `Two Lines on the player, translation docked, in ${name} (${view.label}${turned ? ', turned by Lock Landscape' : ''}): moves of the other line, the lower line's romaji and the docked translation on each line change`,
})

/**
 * Karaoke Style's rows and translation, by real pointer drags: never a dead end (probes/lyric-dock.ts). On desktop
 * and the installed app on its side: Karaoke Style is off upright
 */
const lyricDock = (name: string, view: View): Benchmark => ({
  id: `lyric-dock-${name}`,
  metrics: [
    count('rowsCantReachTop'),
    count('rowsBelowCantReachTop'),
    count('rowsOntoNoDock'),
    count('savedOverlapped'),
  ],
  run: lyricDockAudit(view.surface),
  runs: 1,
  surface: view.surface,
  title: `Karaoke Style's rows and translation in ${name} (${view.label}): the rows' text reaches the top with the translation moved down and with it below them, the rows dropped onto the translation dock, a layout saved overlapped loads usable`,
})

/**
 * The player's controls on a phone on its side, shown: none sits in a shade band wider than it (probes/control-shade.ts).
 * On the installed app on its side, and upright turned by Lock Landscape
 */
const controlShade = (
  name: string,
  view: View,
  turned: boolean
): Benchmark => ({
  id: `control-shade-${name}`,
  metrics: [count('shadedControls'), count('controls', false)],
  run: controlShadeAudit(view.surface, turned),
  runs: 1,
  surface: view.surface,
  title: `The player's controls in ${name} (${view.label}${turned ? ', turned by Lock Landscape' : ''}), shown: controls sitting in a shade band many times their size`,
})

/**
 * Real presses on the top bar (probes/press-release.ts): a tab, the account menu and a dialog button act when they
 * should, and a press taken back does nothing. The scan in every layout audit covers every control; this proves
 * activation still works and the mouse's press-drag-release menu pick
 */
const pressRelease = (view: View): Benchmark => ({
  id: `press-release-${view.name}`,
  metrics: PRESS_RELEASE_FINDINGS.map((key) => count(key)),
  run: pressReleaseAudit(view.surface),
  runs: 1,
  surface: view.surface,
  title: `Real presses on the top bar in ${view.name} (${view.label}): tabs, the account menu and a dialog button act on release, and a press taken back does nothing`,
})

/** A page's audits in its views: at rest, then each state it opens in that view */
const layouts = (page: LayoutPage, views: View[]): Benchmark[] =>
  views.flatMap((v) => [
    layout(page, v),
    ...(page.states ?? [])
      .filter((s) => s.views === undefined || s.views.includes(v.name))
      .map((s) => layout(page, v, s)),
  ])

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
  // Every route in src/app.tsx in all views, so a new page is audited without anyone adding it; iPhone Safari
  // too (its own top bar, no tab bar), on its side where the layout is busiest
  ...layoutPages().flatMap((page) =>
    layouts(page, [
      ...ALL_VIEWS,
      SAFARI_PORTRAIT,
      ...(BUSY_PAGES.has(page.name) ? [SAFARI_LANDSCAPE] : []),
      SAFARI_NARROW,
    ])
  ),
  ...ALL_VIEWS.map(pressRelease),
  lyricShift('pwa-landscape', PWA_LANDSCAPE, false),
  lyricDock('web', WEB),
  lyricDock('pwa-landscape', PWA_LANDSCAPE),
  controlShade('pwa-landscape', PWA_LANDSCAPE, false),
  controlShade('pwa-turned', PWA_PORTRAIT, true),
  lyricShift('pwa-turned', PWA_PORTRAIT, true),
  {
    // The full-screen player on an iPhone on its side, turned by CSS (rotation lock on) and rotated by iOS (lock off,
    // also reached again from the watch page): the same layout within 1px, black side bands (probes/landscape-parity.ts)
    id: 'landscape-parity',
    metrics: [
      count('layoutDiffs'),
      count('blackBandsMissing'),
      count('insetControls'),
      count('boxes', false),
    ],
    run: landscapeParityAudit(),
    runs: 1,
    surface: PWA_LANDSCAPE.surface,
    title:
      'The full-screen player on an iPhone on its side, turned by Full Screen with rotation lock on vs rotated by iOS: element boxes within 1px, safe-area bands black',
  },
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
