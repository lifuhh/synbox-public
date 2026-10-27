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
import { keyboardAudit } from './probes/keyboard'
import { landscapeParityAudit } from './probes/landscape-parity'
import { LAYOUT_FINDINGS, layoutAudit, layoutPages } from './probes/layout'
import type { LayoutPage, OpenedState } from './probes/layout'
import { lyricDockAudit } from './probes/lyric-dock'
import { lyricShiftAudit } from './probes/lyric-shift'
import { lyricUndockAudit } from './probes/lyric-undock'
import { HERO_FLIGHT, motionAudit } from './probes/motion'
import type { Morph } from './probes/motion'
import { playerSession } from './probes/player'
import {
  PRESS_RELEASE_FINDINGS,
  pressReleaseAudit,
} from './probes/press-release'
import { buildSize } from './probes/size'
import {
  THEATER_MOTION_FINDINGS,
  theaterMotionAudit,
} from './probes/theater-motion'
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
  timing: true,
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
    count('rowsMovedByTranslation'),
    count('rowsOntoNoDock'),
    count('savedOverlapped'),
  ],
  run: lyricDockAudit(view.surface),
  runs: 1,
  surface: view.surface,
  title: `Karaoke Style's rows and translation in ${name} (${view.label}): the rows' text reaches the top with the translation moved down and with it below them, a translation let go at the foot below the rows neither docks nor rests over them (and doesn't move them when there's room), the rows dropped onto the translation dock, a layout saved overlapped loads usable`,
})

/**
 * Karaoke Style's docked translation dragged off the rows and back, by real pointer drags, every frame sampled
 * (probes/lyric-undock.ts): the rows never move, and the translation never overlaps them. On desktop, the installed app
 * on its side and upright turned by Lock Landscape: Karaoke Style is off upright
 */
const lyricUndock = (name: string, view: View, turned: boolean): Benchmark => ({
  id: `lyric-undock-${name}`,
  metrics: [
    count('undockRowsMoved'),
    count('undockOverlap'),
    count('undockRefused'),
    count('undockEndedInside'),
    count('redockRowsMoved'),
    count('redockFailed'),
    count('rowsMovedMaxPx', false),
    count('overlapMaxPx', false),
  ],
  run: lyricUndockAudit(view.surface, turned),
  runs: 1,
  surface: view.surface,
  title: `Karaoke Style's docked translation in ${name} (${view.label}${turned ? ', turned by Lock Landscape' : ''}), the block dragged to the middle, the translation pulled to the bottom, the top, just under the block and onto the rows, then dragged back: the rows' lines never move, the translation never overlaps them or the block, comes off where there is room, and docks again`,
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

/**
 * One element turning into another, driven for real and judged frame by frame (probes/motion.ts): nothing teleports,
 * nothing scales against the morph's way, attached parts stay attached, and at least `minFlights` passes are seen to
 * fly (so an audit can't pass on a morph that stopped happening). The page's own frame work gates in Chromium;
 * WebKit's headless frame timing is reported, not judged
 */
const motion = (morph: Morph, view: View, minFlights: number): Benchmark => ({
  id: `motion-${morph.name}-${view.name}`,
  metrics: [
    count('teleports'),
    count('scaleReversals'),
    count('detachments'),
    count('missingFlights'),
    count('unseenParts'),
    count('droppedFrames', view.surface.engine === 'chromium'),
    count('lateFrames', false),
    count('flights', false),
  ],
  run: motionAudit(morph, view.surface, minFlights),
  runs: 1,
  surface: view.surface,
  timing: true,
  title: `${morph.name} in ${view.name} (${view.label}), each way, slow and fast: teleports, scale against the morph's way, detached parts, passes with no flight, parts never shown, frames over 25ms of main-thread work`,
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
  // Home's search flies into the top bar in a browser: on desktop every pass, both ways at both speeds; in iPhone
  // Safari (both ways up) at least the flights home, since a bar that has slid away by the time the field leaves
  // takes it in unseen. The installed app's top bar has no search on Home (measured: no flight in pwa-portrait or
  // pwa-landscape)
  motion(HERO_FLIGHT, WEB, 4),
  motion(HERO_FLIGHT, SAFARI_PORTRAIT, 2),
  motion(HERO_FLIGHT, SAFARI_LANDSCAPE, 2),
  lyricShift('pwa-landscape', PWA_LANDSCAPE, false),
  lyricDock('web', WEB),
  lyricDock('pwa-landscape', PWA_LANDSCAPE),
  lyricUndock('web', WEB, false),
  lyricUndock('pwa-landscape', PWA_LANDSCAPE, false),
  lyricUndock('pwa-turned', PWA_PORTRAIT, true),
  controlShade('pwa-landscape', PWA_LANDSCAPE, false),
  controlShade('pwa-turned', PWA_PORTRAIT, true),
  lyricShift('pwa-turned', PWA_PORTRAIT, true),
  {
    // Theater Mode on the wide watch page, both ways, frame by frame: nothing jumps, appears from nowhere or vanishes
    // while visible, sizes move one way, the video stays on the stage, the YouTube iframe is never rebuilt
    // (probes/theater-motion.ts)
    id: 'theater-motion',
    metrics: [
      ...THEATER_MOTION_FINDINGS.map((key) => count(key)),
      count('droppedFrames', false),
      count('frames', false),
      // From the press's release to the first frame that changes, and to the last: reported, the timing is a
      // headless browser's
      ...['enterStartMs', 'enterDoneMs', 'exitStartMs', 'exitDoneMs'].map(
        (key): MetricSpec => ({ ...ms(key, false, 16, 0), exact: true })
      ),
    ],
    run: theaterMotionAudit,
    runs: 1,
    surface: WEB.surface,
    timing: true,
    title:
      'Theater Mode in and out on the wide watch page (1440×900), every frame: teleports, size reversals, the video or the bar off the stage, the YouTube iframe reloaded; dropped frames reported',
  },
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
  {
    // The app by keyboard alone, as a TV remote drives it (A121): Home → a song → Play/Pause → Lyrics Style → a colour
    // → Escape → search → a result, every stop with a visible focus indicator (probes/keyboard.ts)
    id: 'keyboard-journey',
    metrics: [
      count('unreachableSteps'),
      count('invisibleFocus'),
      count('focusLost'),
      count('weakFocus', false),
      count('tabs', false),
    ],
    run: keyboardAudit(),
    runs: 1,
    surface: WEB.surface,
    title:
      'Keyboard only at 1920×1080: every journey step reachable by Tab/Enter/Escape, a visible focus indicator at every stop, focus never lost',
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
