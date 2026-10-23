# Synbox harness

The checks that judge a change before it ships, so an agent's "done" comes with evidence. Three commands:

- **`bun harness/bench/cli.ts check`**: exact checks, about 35 seconds. Every PR into `staging` needs it to pass on its committed tree, and every release runs it again on staging's combined tree.
- **`bun harness/views.ts <path-or-url>`**: one page in all views, audited and shot side by side, for looking at a UI change.
- **`bun harness/bench/cli.ts trend`**: timing benchmarks, minutes to an hour, off the release path. It writes what it finds to a queue for a person to read; it never blocks anything.

**All views** are web (desktop Chromium 1440×900), PWA portrait (WebKit iPhone 390×844, installed) and PWA landscape (WebKit 844×390, installed), every phone view with the iPhone's safe areas. They are defined once, in `bench/engines/browser.ts` › `ALL_VIEWS`, and both `check` and `views.ts` read them from there.

## Before a PR into staging: `check`

```sh
bun harness/bench/cli.ts check                         # in your worktree, on committed code
bun harness/bench/cli.ts check --only layout-player    # just the audits whose id starts with this, while you work (no verdict)
```

It runs, and stops at the first failure:

1. **Evaluator guard.** A branch that edits the evaluator together with app code (`src/`, `public/`, `index.html`, `vite.config.ts`, `bun.lock`, `netlify/`) fails: land the evaluator change in its own PR, judged against an unchanged app. The evaluator is whatever decides what `check` runs and how it judges: everything in `harness/bench/` except `trend.ts`, the scripts in `package.json`, `harness/release.ts` and `harness/gate.json`. Not the evaluator: `harness/budgets.json` and `harness/routes.json`, which change beside the app on purpose.
2. **Audit list**: `src/app.tsx` yields routes, and every route named in `harness/bench/probes/layout.ts` › `LAYOUT_PAGES` or `harness/routes.json` is one of them. A router refactor can't silently drop audits.
3. **`typecheck`, `lint`, `test`, `fmt:check`**, beside the production build.
4. **Size**: brotli KB of first-load JS, first-load CSS and all JS, against `harness/budgets.json`. A pass prints each value over its budget, so the headroom shows.
5. **Layout audits**: every route in `src/app.tsx` except those `harness/routes.json` › `skip` lists with a reason, in all views (`layout-<page>-web`, `-pwa-portrait`, `-pwa-landscape`), and in iPhone Safari (`-safari-portrait`; `-safari-landscape` for home, gallery, player and search only, where the layout is busiest). Each audit counts press targets under 24px, covered at their centre, cut off by the viewport's sides, or (fixed or sticky, on a phone) inside a safe-area inset; sideways overflow; uncaught page errors; and `console.error` lines from the app's own scripts (the app logs a crash its error boundary caught that way; third-party scripts such as the YouTube player's, and the browser's network log, `probes/layout.ts` › `BENIGN_CONSOLE`, are ignored). The first app error ends the wait for the page to get ready, so a crashed page fails in seconds. Every count's budget is 0 unless `harness/budgets.json` says otherwise. Three audits run at a time.

A pass needs every one of these steps to have run exactly once; anything less is a failure. Each step prints its seconds. A pass stamps `<main checkout>/.harness/verdicts/<tree>.json` (`kind: check`), which the global PR hook (`~/.claude/hooks/harness-gate.py`, configured by `harness/gate.json`) requires before `gh pr create --base staging`. A new commit is a new tree and needs a new run. Uncommitted changes get checked but not stamped.

When it fails:

| Failure | Do |
| --- | --- |
| A static check | Its output's last lines are printed. Fix it. |
| `size`: `initialJsKB 355.8 > budget 327` | Find what grew (the failing step lists the first-load files). If the growth is intended, raise that number in `harness/budgets.json` in the same PR, with the reason under `$why` and in the PR description. |
| `layout-<page>-<view>`: `smallTargets 1 > budget 0` | The lines below name each offending element and its box, then the path of a screenshot. Fix the layout. A budget raise here needs the same written reason. |
| `no sample: mark "x" never fired` | A `data-bench` hook the audit waits for is gone (see "How the audits keep up with the app"). Put it back on whatever replaced it. |
| The evaluator guard | Split the branch. |

An audit that produced nothing (a page that never got ready) is run once more; a pass on the second try says `retried after: …`. A count over budget is never re-run: a layout bug that shows one time in three still fails.

## Looking at one page: `views.ts`

```sh
bun harness/views.ts /v/6rG_irmOQsM                            # this working tree's production build, in all views
bun harness/views.ts /v/6rG_irmOQsM --compare origin/staging   # before/after, one row per view; a git ref is built
bun harness/views.ts /about --compare https://synbox.io        # before from a URL or origin (the page's path is added)
bun harness/views.ts / --port 5174                             # a server already running (`wt serve`)
```

Each view gets the same audit `check` runs (`probes/layout.ts` › `auditPage`, `pageAt`: it waits for the page as its route's audit does, `/` as home, and uses the same safe areas and installed emulation), and one line per view: `ok`, or the counts over 0 and the offending elements. It writes `.reports/YYYY-MM-DD-views-<slug>/index.html`, the screenshots side by side on a dark page (one row per view with `--compare`), prints its path, and exits 3 when a view has a finding. Without `--port`, the build is served the way `check` serves it, with the same replayed API data.

## Shipping: staging, then one release

Finished work is merged into `staging`, never into `main`. `bun harness/release.ts` ships everything in staging as one merge to `main`, which is one Netlify build. The global hook blocks every other way into `main`: a PR into it, a merge into it and a push to it.

```sh
bun harness/release.ts --dry-run   # what staging would ship
bun harness/release.ts --preview   # one deploy preview of staging, for a phone check
bun harness/release.ts             # check staging's tree, PR staging → main, merge, wait until live
```

The release runs `check` on staging's tree every time (per-PR verdicts judged other trees), unless nothing in `harness/gate.json` › `paths` differs from `main`. It stops on a failure: fix it in a PR into staging and release again. One release runs at a time on a machine (a lock in `.harness/release/`). A release that changes only docs, the harness, scripts or Markdown costs no Netlify build (`scripts/netlify-ignore.sh`).

## Timing: `trend`

```sh
bun harness/bench/cli.ts trend --reference origin/main         # first run: pin the reference commit (a release you trust)
bun harness/bench/cli.ts trend                                 # origin/main against the pinned reference
bun harness/bench/cli.ts trend --only home --ref origin/staging
```

It builds both commits, serves both at once, and alternates them sample by sample (reference, candidate, candidate, reference, …), at least 12 samples a side, each side warmed up once. A machine that slows down mid-run slows both sides alike. Per metric: Mann–Whitney U, Holm-corrected across a benchmark's gated metrics, and a change must also exceed `max(floor, pct × reference)` (set per metric in `suite.ts`). A metric is `inconclusive`, never `unchanged`, when it has no samples on a side, or when it is underpowered: even the most extreme split of its sample counts would give a Holm-adjusted p of at least 0.05.

The report lands in `.harness/bench/runs/trend-<time>/report.md` and one line per run is appended to `.harness/queue.md` in the main checkout: `regressed`, `inconclusive` or `unchanged`, with the metrics named. Read the queue, then decide what to do about a regression; the release doesn't wait for it. It waits up to 5 minutes for a quiet machine (load under half the cores) and holds the machine lock, so a `check` started meanwhile waits for it (layout audits must not share the machine with timings). Nothing schedules it; run it after a release, or schedule it yourself.

| Benchmark | Surface | Metrics |
| --- | --- | --- |
| `home` | desktop Chrome, 4× CPU | FCP, LCP, CLS, hero box visible, first typed character, recommendations / charts / gallery ready, Next press, gallery scroll fps, dropped frames, blank tiles, blocking |
| `home-load` | cdp-perf mobile lab (4× CPU, slow 4G) | FCP, LCP, CLS, TBT |
| `player-<id>` (4 songs) | desktop Chrome, 4× CPU | iframe, ready, lyrics data, playback start, pause / resume / seek latency, playback fps, dropped frames |
| `player-load` | cdp-perf mobile lab | FCP, LCP, CLS, TBT |
| `hero-type` | cdp-perf flow, 4× CPU | typing latency and blocking |

`bun harness/bench/cli.ts list` prints every benchmark and which command runs it.

## How the checks stay trustworthy

- **Same data every run.** The bench serves a production build the way Netlify does (brotli, cache headers, the `/api` proxies from `netlify.toml`). API responses, the lookup service included, and Google Fonts are recorded once and replayed. Only successful responses are recorded. `Math.random` is seeded. Sentry is blocked. To re-record API data, delete `.harness/bench/fixtures/` in the main checkout.
- **Settled on signals, not sleeps.** Each audit waits for its page's own readiness (`data-bench` marks; on other routes, the route's lazy chunk rendered into the root layout's outlet and no `aria-busy` region; the player out of loading), then for the layout to rest: fonts loaded, no finite animation running, and every press target's box unchanged over two frames (`engines/recorder.ts` › `settle`, capped at 5 s; an audit that never rests says so in its notes). That is what lets three audits share the machine without false failures.
- **Budgets, not baselines.** Nothing is compared with an earlier run, so there is nothing to bootstrap, pool or re-measure. Growth is accepted by a visible edit to `harness/budgets.json` in the PR that causes it.
- **The evaluator is read-only to the app.** See the guard above.

## How the audits keep up with the app

- **Hooks, not markup.** Probes wait for elements the app marks with `data-bench` (`carousel`, `carousel-slide`, `charts`, `charts-row`, `gallery`, `gallery-tile`, `hero-input`, `lyrics-line` (the stage's current lines), `lyrics-text` (the lyrics panel and reader), `search-result`; `engines/recorder.ts` › `WATCH`). Player controls are found by their accessible names (Play, Pause, Seek). Keep the attribute on whatever replaces an element.
- **Pages from the router.** The audits read the routes in `src/app.tsx`. A new route without parameters is audited once it settles. A route with parameters needs a sample URL in `harness/routes.json` › `samples`, or a reason in › `skip`, in the PR that adds it; until then its audit fails and says so. Pages with readiness code of their own are in `probes/layout.ts` › `LAYOUT_PAGES` (the evaluator). Removing such a page's route takes two PRs: drop its entry first (the route then gets the generic audit), then the route.
- **The installed app.** The `pwa-portrait` and `pwa-landscape` views are the iPhone screens with `navigator.standalone` set, which the app reads for its tab bar and short top bar. Their audits fail if the page didn't switch to the installed layout.

## A task's worktree: `wt.ts`

```sh
bun harness/wt.ts start fix/<slug> --session <name>   # ../synbox-<slug> from origin/staging, owner recorded, packages installed
bun harness/wt.ts serve                                # in the worktree, as a background task: dev server on the first free port
bun harness/wt.ts finish <slug>                        # keep .reports/, remove the worktree, delete the merged branch
```

Nothing in it kills a process or forces a removal. `serve` is stopped by stopping its task. `finish` refuses while the worktree has uncommitted changes, while the branch is not in `staging`, or while its dev server still answers, and says which.

## Known limits

- The hook reads the command text. A command hidden in a wrapper (`bash -c "gh pr merge …"`, a script, `gh api` calls to the pulls endpoints) is not seen. The release script's own `gh` calls rely on this.
- `trend` is not scheduled; nothing runs it unless someone does.

## Requirements

Bun, Google Chrome, Playwright's WebKit (`bunx playwright install webkit`), and, for `trend`, the frontend-perf skill's cdp-perf (`~/.claude/skills/frontend-perf/scripts/cdp-perf`, or set `CDP_PERF`). Builds read the main checkout's env file like `vp build` does; nothing here reads or prints it.
