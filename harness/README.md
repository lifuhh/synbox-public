# Synbox harness

The checks that judge a change before it ships, so an agent's "done" comes with evidence. The first piece is the bench: performance and layout of the key journeys, judged against a rolling baseline, with a verdict the PR gate reads.

## Before you open a PR into main

```sh
bun run bench:gate        # = bun harness/bench/cli.ts gate; commit first, it judges the committed tree
```

A global Claude Code hook (`~/.claude/hooks/harness-gate.py`, configured by `harness/gate.json`) blocks `gh pr create` / `gh pr ready` for a PR into `main` that touches the app until this tree has a `pass`, `warn` or `waived` verdict. That is where work is consolidated: the batch's integration PR, or a lone fix. A piece of a batch opened into `integrate/<batch>` is not gated; the batch is, as a whole. The gate takes about 8 minutes; the first run on a machine, or after a probe changes, also measures the merge base to create the baseline, which roughly doubles it.

| Verdict | Meaning | Do |
| --- | --- | --- |
| `pass` | No gated metric regressed | Open the PR |
| `warn` | A gated metric drifted the wrong way without proof, a run errored, or a landmark moved | Read the report; mention the drift in the PR if it is real |
| `fail` | A gated metric regressed (confirmed against `origin/main` measured interleaved), a benchmark produced no samples, or the branch edits the scorer and the app together | Fix it and re-run. If the regression is intended: `bun harness/bench/cli.ts waive --reason "<why>"`, and say so in the PR |

The report prints to the terminal and is saved under the main checkout's `.harness/bench/runs/<run id>/report.md`, next to each layout audit's screenshot.

## What it measures

`bun harness/bench/cli.ts list` prints every benchmark. In short:

| Benchmark | Surface | Gated metrics |
| --- | --- | --- |
| `size` | build output | first-load JS, CSS, all JS (brotli KB) |
| `home` | desktop Chrome, 4× CPU | FCP, LCP, CLS, hero box visible, first typed character, recommendations / charts / gallery ready, Next press → scroll end, gallery scroll fps, dropped frames, blank tiles, blocking |
| `home-load` | cdp-perf mobile lab (4× CPU, slow 4G) | FCP, LCP, CLS, TBT |
| `player-<id>` | desktop Chrome, 4× CPU | iframe, player ready, lyrics data, playback start, pause / resume / seek latency, playback fps and dropped frames |
| `layout-<page>-<screen>` | every route in `src/app.tsx` × desktop Chromium 1440×900, WebKit iPhone 390×844 in Safari and as the installed app, all with safe areas; home, gallery, player and search also at 844×390 | sideways overflow, covered, small (< 24px), off-screen and safe-area press targets; landmark moves are reported |

Tiers: `smoke` runs at the gate; `full` (`--tier full`) adds two more songs, the player page load and typing latency. `player-Dta27KjGpJs` is held out: it runs at the gate but never counts in the hill-climb score.

## How it decides

- **Same data every run.** The bench serves a production build the way Netlify does (brotli, cache headers, the `/api` proxies from `netlify.toml`). API responses, the lookup service included, and Google Fonts are recorded once and replayed. `Math.random` is seeded. Sentry is blocked.

## How it keeps up with the app

- **Hooks, not markup.** Probes wait for elements the app marks with `data-bench` (`carousel`, `carousel-slide`, `charts`, `charts-row`, `gallery`, `gallery-tile`, `hero-input`, `lyrics-line` (the stage's current lines), `lyrics-text` (the lyrics panel and reader), `search-result`; `engines/recorder.ts` › `WATCH`). Player controls are found by their accessible names (Play, Pause, Seek). A redesign keeps the bench working as long as it keeps the attribute on the element that means the same thing. When one goes missing, the run fails with `mark "<name>" never fired` and lists the marks it did see.
- **Pages from the router.** The layout audits read the routes in `src/app.tsx`. A new route without parameters is audited on its own once it settles. A route with parameters needs a sample URL in `probes/layout.ts` › `LAYOUT_PAGES`, or a reason in `LAYOUT_SKIP`. Until it has one, its audit fails and says so.
- **The installed app.** The `installed` screen is the iPhone portrait screen with `navigator.standalone` set, which is what the app reads for its tab bar and short top bar. The audit fails if the page didn't switch to the installed layout.
- **Who fixes it.** The gate runs on every PR into `main`, so a change that breaks a probe fails its own PR. Its author updates the hook or the probe there, in the same PR.
- **Rolling baseline.** Samples pooled from the last 3 accepted runs of the merge base's tree on this machine, under the same conditions and benchmark definition. A branch merged on top of `main` produces exactly that tree, so its own passing gate run becomes the baseline for the next branch: the average updates after every successful gate, with no extra measuring. When `main` has moved and its tree has no runs yet, the gate measures it first. An abandoned branch or a reverted climb step never counts.
- **Statistics.** Mann–Whitney U per metric, Holm-corrected across the gated metrics, and the change must exceed `max(floor, pct × baseline)` (set per metric in `suite.ts`). Byte and layout counts compare exactly.
- **No re-rolling.** Re-running an unchanged tree adds samples to the same pool.
- **Confirm before failing.** A suspected regression is re-measured against the merge base, interleaved in B A A B blocks of 4 runs (each warmed up), so a busy laptop can't fake one or hide one. The confirm samples are kept in the run record.
- **New definition, new baseline.** Each benchmark's spec hash covers its metrics and the source of its probe files. Change a probe and its old baselines stop matching; the gate then measures the merge base afresh.
- **The scorer is read-only to app changes.** A branch that changes `harness/bench/scorer/` and app code together fails the gate.

## Other commands

```sh
bun harness/bench/cli.ts run [--tier full] [--only home,size] [--api live]   # measure and judge, no verdict
bun harness/bench/cli.ts baseline [--ref origin/main]                         # measure a ref into the baseline
bun harness/bench/cli.ts history                                              # runs, wall time, noise (CV), errors
bun harness/bench/cli.ts score                                                # hill-climb objective for this tree
bun harness/bench/cli.ts climb propose <campaign> "<hypothesis>"              # freeze a hypothesis
bun harness/bench/cli.ts climb eval <campaign>                                # measure, score, accept or reject
bun harness/bench/cli.ts climb board <campaign>                               # leaderboard
```

To re-record API data (after a backend change), delete `.harness/bench/fixtures/` in the main checkout and bump `.harness/bench/fixtures-epoch`. The epoch is part of the run conditions, so old baselines stop matching.

## Hill-climbing

To make something faster, climb the score instead of eyeballing numbers:

1. `climb propose perf-home "Lazy-load the charts table; chartsMs and LCP should drop because …"`, before any measurement.
2. Make that one change and commit it.
3. `climb eval perf-home` measures the tree and computes the geometric mean of improvement ratios over the gated metrics (1.0 = baseline), with held-out benchmarks hidden. It accepts only if nothing fails and the score beats the best so far. Keep accepted commits and revert rejected ones.
4. `climb board perf-home` shows what was tried. Read it before the next proposal.

An unchanged tree can't be evaluated twice.

## Requirements

Bun, Google Chrome, Playwright's WebKit (`bunx playwright install webkit`), and the frontend-perf skill's cdp-perf (`~/.claude/skills/frontend-perf/scripts/cdp-perf`, or set `CDP_PERF`). Builds read the main checkout's env file like `vp build` does; nothing here reads or prints it.

Keep the machine otherwise idle while the gate runs. Measuring during a build or a test suite shows up as noise, and the gate warns when its speed probe sees the machine more than 15% slower than during the baseline.
