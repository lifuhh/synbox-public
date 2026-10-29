# Synbox harness

The checks that judge a change before it ships, so an agent's "done" comes with evidence. Four commands:

- **`bun harness/bench/cli.ts check`**: exact checks. A PR's check runs every static check, the build and the size budgets, and only the browser audits its diff can affect: one to four minutes. Every release runs it again (`--full`) on staging's combined tree. A docs-only commit after a passing run reuses its verdict in about a second, and checks from several sessions run at once ("Sharing the machine").
- **`bun harness/views.ts <path-or-url>`**: one page in all views, audited and shot side by side, for looking at a UI change.
- **`bun harness/smoke.ts --local`**: the same flows on a production build of this checkout served by Netlify's own runtime on this machine (`harness/local-site.ts`): no Netlify build minutes, about 45 seconds with the build. Run it before anything that builds on Netlify.
- **`bun harness/smoke.ts <url>`**: the main user flows on a real deployed copy (a deploy preview, or https://synbox.io) against the real backends, read-only, about 40 seconds. `check` judges code and layout on recorded data; this is the check that the site still works.
- **`bun harness/bench/cli.ts trend`**: timing benchmarks, minutes to an hour, off the release path. It writes what it finds to a queue for a person to read; it never blocks anything.

**All views** are web (desktop Chromium 1440×900), PWA portrait (WebKit iPhone 390×844, installed) and PWA landscape (WebKit 844×390, installed), every phone view with the iPhone's safe areas. They are defined once, in `bench/engines/browser.ts` › `ALL_VIEWS`, and both `check` and `views.ts` read them from there.

## Before a PR into staging: `check`

```sh
bun harness/bench/cli.ts check                         # in your worktree, on committed code: scoped to the branch's diff
bun harness/bench/cli.ts scope                         # what that would run, and why, without running anything
bun harness/bench/cli.ts check --only layout-player    # just the audits whose id starts with this, while you work (no verdict)
bun harness/bench/cli.ts check --full                  # every audit, never reusing a verdict (the release runs this)
```

**Scope** (`bench/scope.ts` › `selectBenches`). The static checks, the build and `size` always run. Each browser audit declares what it visits (`suite.ts`: `scope: { routes, probe }`), and runs when the branch's diff against its merge base with `origin/staging` (committed, uncommitted and untracked files) reaches it:

- **A page's files.** The import graph is walked statically: every file's static imports, re-exports and `import()`s with a literal path, read with the bundler's own parser (`vite` › `parseSync`; type-only imports ship nothing and are skipped), `@/` resolved as `tsconfig.json` and `vite.config.ts` alias it, CSS `@import`s followed. `src/app.tsx`'s syntax tree says which module each route renders (a static import, `lazy(() => import(…))`, or `lazy(pageImports.key)`; a Suspense fallback is not the page). A changed file reached from one route's page module runs that route's audits: a copy change in `src/components/generate-lyrics/` runs home's and gallery's layouts and `keyboard-journey`, which starts on home. Static, not the build's module graph, because it needs no build, takes half a second, and sees exactly the imports the build follows.
- **Only the exports that changed** (`bench/exports.ts` › `changedExports`). A module that exists on both sides of the diff is compared statement by statement: a binding changed when its text did, or when it refers to a changed binding. If only some exports changed, the module is replaced by the modules that import one of those, each counted whole; if none did (a type or a comment between statements), it is dropped. A change to code that runs on import (a top-level call, a side-effect import, `export *`) counts the whole module. A route's page module always counts as itself. So a constant added to `src/lib/auth.ts` reaches the files that use it, not the player, which imports `auth.ts` for other exports. The check prints each narrowing (`src/lib/auth.ts: only SONGS_A_DAY changed, so its importers of those (6) count instead`).
- **The shell.** Everything `index.html`'s entry (`src/main.tsx`) reaches without entering a route's page module (`src/globals.css`, the root layout, the top bar, the `ui/` components they use, and what those load lazily) is on every page: a change there runs every page's audits. An audit that declares which part of the shell it observes (`scope.shell`: the top bar for the player's chrome, morph and lyric-shift audits; nothing for lyric dock, undock and drag, which measure the stage alone) runs for a shell change only inside that part, or when its page imports the changed module itself. The frame (the entry, `src/app.tsx`, the root layout) and stylesheets still run every audit.
- **Files the build or the bench server read**: anything outside `src/`, `harness/` and the docs except `worker/`, `scripts/` and repo chores (`.github/`, `LICENSE`, `components.json`): `public/`, `index.html`, `vite.config.ts`, `package.json`, `bun.lock`, `netlify/`, `netlify.toml`, `tsconfig.json`. Every audit.
- **The evaluator.** A changed file inside a probe's import graph (`probes/lyric-dock.ts` and what it imports, which includes `probes/layout.ts` and `engines/browser.ts`) runs that probe's audits. A file in `harness/bench/` that no probe imports (`suite.ts`, `check.ts`, `scope.ts`, `server.ts`, `build.ts`) is the check itself: every audit. `harness/routes.json`: every audit. `harness/budgets.json`: the benchmarks whose lines changed. The evaluator guard (below) runs on every check.
- **Never narrowed on a guess.** A route whose page module isn't found runs on any `src/` change; a benchmark with no `scope` always runs; anything the scope can't work out (no merge base, a file that won't parse) runs everything and says why. A clean checkout of staging itself has no branch to scope and runs everything.

The check prints the selection grouped by reason (`scope: 9 of 165 checks …`, then `12 × /: src/…` lines), and the verdict records it under `scope`: `mode` (`scoped` or `full`), the merge `base`, `why` (what widened it), `ran` (each audit and why) and `skipped`.

It runs, and stops at the first failure:

1. **Evaluator guard.** A branch that edits the evaluator together with app code (`src/`, `public/`, `index.html`, `vite.config.ts`, `bun.lock`, `netlify/`) fails: land the evaluator change in its own PR, judged against an unchanged app. The evaluator is whatever decides what `check` runs and how it judges: everything in `harness/bench/` except `trend.ts`, the scripts in `package.json`, `harness/release.ts`, `harness/smoke.ts` and `harness/gate.json`. Not the evaluator: `harness/budgets.json` and `harness/routes.json`, which change beside the app on purpose.
2. **Audit list**: `src/app.tsx` yields routes, and every route named in `harness/bench/probes/layout.ts` › `LAYOUT_PAGES` or `harness/routes.json` is one of them. A router refactor can't silently drop audits.
3. **`typecheck`, `lint`, `test`, `fmt:check`**, beside the production build.
4. **Size**: brotli KB of first-load JS, first-load CSS and all JS, against `harness/budgets.json`. A pass prints each value over its budget, so the headroom shows.
5. **Layout audits**: every route in `src/app.tsx` except those `harness/routes.json` › `skip` lists with a reason, in all views (`layout-<page>-web`, `-pwa-portrait`, `-pwa-landscape`), in iPhone Safari (`-safari-portrait`; `-safari-landscape` for home, gallery, player and search only, where the layout is busiest), and at 320px wide (`-safari-narrow`, 320×568 Safari: WCAG's reflow width, where a page must still fit). Each page is audited at rest and again with each UI state a user opens on it (`layout-<page>-<view>+<state>`, below). Each audit counts press targets under 24px, covered at their centre, cut off by the viewport's sides, or (fixed or sticky, on a phone) inside a safe-area inset; anything else a fixed or sticky layer paints inside an inset (`insetSurfaces`); sideways overflow, and the page panned sideways (`panXPx`: `scrollX`, `visualViewport.offsetLeft`); text fields under 16px on a phone (`zoomInputs`: iOS zooms into one on focus, and the page then pans while the keyboard is up); placeholders wider than their field and single-line control labels or headings cut off with no `title` or `aria-label` holding the full text (`clippedText`); controls and dialogs with no accessible name (`unnamedControls`: aria-labelledby, aria-label, a `<label for>`, the content without its aria-hidden parts, title); boxes that scroll but hold nothing focusable and take no focus, so a keyboard can't scroll them (`unscrollableRegions`); the page or a scrolling box still scrolling smoothly with Reduce Motion emulated (`smoothScrollReduced`); uncaught page errors; and `console.error` lines from the app's own scripts (the app logs a crash its error boundary caught that way; third-party scripts such as the YouTube player's, and the browser's network log, `probes/layout.ts` › `BENIGN_CONSOLE`, are ignored). The first app error ends the wait for the page to get ready, so a crashed page fails in seconds, and an audit stuck for 45 s (up to 90 s while the machine is busy: the limit scales with the 1-minute load over the cores, capped at twice) fails and names the wait it was in (`LayoutPage.ready`'s `note`); it is then run once more, and the final line says so: `check PASS in 88s (retried: <audit>, <why>)`. Every count's budget is 0 unless `harness/budgets.json` says otherwise. Three audits run at a time per check, within the machine's browser slots ("Sharing the machine", below).

   **Opened states** (`probes/layout.ts` › `OPENED_STATES`, by route): the top bar's search (`search-field` from 768px wide, `search-button` on a phone upright) and its Notifications, Library and More menus on `/privacy` (an ordinary page: the installed app's tab pages hide the menus), the search on the player too, the Search page with a query typed (`typed`), the player's floating controls (`controls`), its Lyrics Style panel (`style`: a popover with a mouse, a dialog on touch; `style-floating` on a phone on its side, from the floating rail), the upright watch page's lyrics expanded under the video (`lyrics-expanded`), and the reader's Text Style bar (`text-style`). A state is a list of steps (press, hover, focus a field, type, and `shows`, the thing it opened), each control found by its accessible name or a `data-bench` hook, in the views the state names. A control that is missing, on screen twice, or closed again before the audit fails the audit, the way a missing `data-bench` hook does. What a state opens over the page (a menu over the bar's buttons) is not counted as covering them. Neither is content scrolled under a sticky bar of its own scroll box (a dialog's list under its header).

   **What the insets may show** (`engines/recorder.ts` › `INSET_BACKDROPS`): the top scrim and the reader's status scrim, and any background-only box running the screen's full width or height (a bar's background padding the status bar, a full-screen sheet). What they hold is still checked; content scrolling inside a layer is not.

6. **Lyric shifts** (`lyric-shift-pwa-landscape`, `lyric-shift-pwa-turned`; `probes/lyric-shift.ts`): the player (`/v/6rG_irmOQsM`) with Two Lines on and the translation shown and docked under the rows, in the installed app on its side and upright turned by Lock Landscape (Fullscreen, then Lock Landscape; the turn restarts the song, so its intro is skipped again). Once the rows show, the song plays for 22 s, sampled every 80 ms in the page, boxes in the page's axes. On each line change where exactly one row's text changed it counts `otherLineMoves` (a row of the unchanged line moved more than 1px); at any sample, `lowerRomajiMoves` (the lower line's last row's bottom moved) and `dockedTranslationMoves` (the docked translation's top moved). All three are budgeted 0: the owner's rule (2026-10-25) that a line change moves as little as it can, which matters most on a phone's short screen. `lineChanges` is reported; a run that saw none is no sample (it measured nothing) and is run once more like any audit that produced nothing. A failure's notes name each move: the row, the pixels and the line it changed for. Fix the layout (`src/components/player-stage/stage-lyrics.tsx` › `TwoRows`, `two-line-layout.ts`), never the budget. They sample over time, so they run last, once the machine is theirs (`timing` in `suite.ts`; "Sharing the machine", below), as do the motion audits (`motion-*`, `theater-motion`), which judge every frame.
7. **Theater motion** (`theater-motion`; `probes/theater-motion.ts`): on the wide watch page (desktop Chromium, 1440×900) it presses Theater Mode, records every rendered frame until the page is still, then Default View and again. Each frame it reads where the stage, the video's layer, the control bar, both lyrics panels, the song (and its title, channel line and action row), More Like This and Up Next are drawn and how opaque: from the element (transforms included), or, inside a view transition, from the snapshot pseudo-elements that draw it (the recorder wraps `startViewTransition` to learn which). It counts the parts, per direction, that `teleports` (an edge jumps more than 48px and more than 35% of its whole travel in one frame, or opacity changes by more than 0.5 in one frame: appearing from nowhere, vanishing while visible; or both snapshots of a view transition draw it at once starting more than 1px apart: a cross-fade between two places), that `scaleReversals` (a width or height turning back), that count as `detachments` (the video off the stage, the bar outside it), and `iframeReloads` (the YouTube iframe replaced, moved in the document, which reloads it, or pointed elsewhere; its own load events are not counted, as the embed navigates inside itself while it plays). Reported: `droppedFrames`, and from the press's release to the first and last frame that changed (`enterStartMs`, `enterDoneMs`, `exitStartMs`, `exitDoneMs`). Frames a view transition holds before its snapshots draw count as the old page. `theaterRun(url, dir)` runs it against any served copy while working.
8. **Translation undock** (`lyric-undock-web`, `-pwa-landscape`, `-pwa-turned`; `probes/lyric-undock.ts`): the player with Karaoke Style on and the translation docked under the rows (desktop, the installed app on its side, upright turned by Lock Landscape; Karaoke Style is off upright), at the default and the largest size. Real pointer drags move the block to the middle of the stage, then pull the translation off to the bottom, the top, just under the block and onto the rows, each followed by a drag back onto the block; every frame of each drag and its settling is measured in the page's axes. Gated at 0: `undockRowsMoved` and `redockRowsMoved` (the rows' drawn lines moved more than 1px), `undockOverlap` (the translation's drawn text over the rows' lines, or, off the rows, over the block's area: the lines plus the docked translation's place), `undockRefused` (pulled to the bottom or top with room there, it stayed docked), `undockEndedInside` (let go inside the block, it stayed there on its own), `redockFailed`. `rowsMovedMaxPx` and `overlapMaxPx` are reported. Each note names the case, the pixels, the direction and the frame. Fix the dock (`stage-lyrics.tsx` › `useTranslationDock`, `DockedTranslation`), never the budget. About 90 s on desktop, 50 s on a phone view.

A pass needs every selected step (all the static ones, and the audits the scope chose) to have run exactly once; anything less is a failure. Each step prints its seconds. A pass stamps `<main checkout>/.harness/verdicts/<tree>.json` (`kind: check`), which the global PR hook (`~/.claude/hooks/harness-gate.py`, configured by `harness/gate.json`) requires before `gh pr create --base staging` and `gh pr merge` while per-PR checks are on (`gate.json` › `check_prs`). Since 2026-10-27 the owner's override in `~/.claude/hooks/harness-gate.json` › `skip_staging_pr_checks` turns them off for this repo: the hook then requires nothing for a PR into staging, and the release's full check is the gate. A new commit is a new tree and needs a new run, except a docs-only one: when the commits since the nearest passing verdict on the branch (first parent, up to 20 back) change only docs (`docs/`, Markdown outside `src/` and `public/`; `bench/reuse.ts` › `isDocs`), `check` stamps this tree with that verdict in about a second, `reused` naming the tree and files it came from. A tree that already passed runs nothing. `--full` never reuses. The PR hook applies the same docs rule. Uncommitted changes get checked but not stamped.

When it fails:

| Failure | Do |
| --- | --- |
| A static check | Its output's last lines are printed. Fix it. |
| `size`: `initialJsKB 355.8 > budget 327` | Find what grew (the failing step lists the first-load files). If the growth is intended, raise that number in `harness/budgets.json` in the same PR, with the reason under `$why` and in the PR description. |
| `layout-<page>-<view>`: `smallTargets 1 > budget 0` | The lines below name each offending element and its box, then the path of a screenshot. Fix the layout. A budget raise here needs the same written reason. |
| `no sample: opened state "x", step 2 (press button "Library"): … never showed` | The control a state presses is gone or renamed. Put its accessible name back, or update the state in `OPENED_STATES` (the evaluator, its own PR). |
| `no sample: mark "x" never fired` | A `data-bench` hook the audit waits for is gone (see "How the audits keep up with the app"). Put it back on whatever replaced it. For `player-iframe` the line ends with `YouTube API scripts unanswered: …`: a script named there with its wait (`iframe_api for 30s`) is the network, not the app; `none` means the scripts arrived and the app never built the player. |
| `no sample: machine stalled: <pass> stalled on all 3 attempts` | A motion audit (`motion-*`, `theater-motion`) saw a frame gap hide a jump on every attempt ("Sharing the machine" › stalls). Run it again on a quieter machine. If every attempt names the same frame and a similar gap, the long frame is the page's own: read `frames.json` there as a teleport. |
| The evaluator guard | Split the branch. |

An audit that produced nothing (a page that never got ready) is run once more; a pass on the second try says `retried after: …`. A count over budget is never re-run: a layout bug that shows one time in three still fails.

**What only the full check sees.** The scope follows imports, so a PR's check can miss: CSS that reaches another page without an import (a new Tailwind utility in one page's file is generated into the one stylesheet; a global selector added in a page's own CSS); behaviour that crosses pages through shared state rather than imports (local storage, the query cache, a service worker); and data the replayed fixtures change. The release's `check --full` on staging's combined tree covers all of these before anything goes live, and two PRs that each pass their own scope are judged together there.

## Sharing the machine

Several sessions run checks on this machine at once. `bench/lock.ts`:

- **Browser slots.** Each browser audit takes one of 3 machine-wide slots (`SLOTS`, files in `<main checkout>/.harness/bench/slots/`) for as long as it runs, then gives it back, so audits from several sessions' checks interleave instead of one check holding the machine for its whole run. The static checks and the build take no lock at all. Measured on 2026-10-27 (M4 Pro, 14 cores, 24 GB, other sessions keeping the load at 45 to 85): the same 34 layout audits took 30 s three at a time, 18 s six and 15 s eight, the median audit flat at 2.0 s; nine took 19 s and twelve 22 s, the median up to 3.1 s. Up to eight slots is safe.
- **The machine to itself.** Timing work takes the exclusive lock (`.harness/bench/machine.lock.json`), then waits for every other run's audits to finish; while it holds the lock no new audit starts. That is `trend`, and the audits marked `timing` in `suite.ts` (lyric shifts, which sample every 80 ms while a song plays; the motion audits, which judge every frame). A check runs its timing audits last, after giving back its slots.
- **Stalls in the motion audits.** Holding the machine doesn't stop other sessions' builds and browsers, and on a loaded machine (2026-10-27) the browser drew nothing for 105 ms in the middle of a hero flight, and for 4 s after Theater Mode's press: what moved meanwhile read as teleports. A frame over 50 ms after the one before (or three of the pass's median frames, if longer; recorded passes run 16.8 ms at the median, 34 ms at the 99th percentile) is a stall: a jump across it, or across the frame after it (where what the page did during the stall is drawn), is not counted. When a stall hid a jump, the pass runs again (the speed's passes in order, or Theater Mode in and out), up to twice, and the first attempt where none did is judged; one that hid nothing costs nothing. Every attempt stalled is `no sample: machine stalled`, retried like any audit that measured nothing, never a pass. A jump between frames a normal interval apart is judged as before. `stalledFrames` and `redos` are reported, and each redo is a note naming the gap. `probes/motion.ts` › `stallLimit`, `judge`; `probes/theater-motion.ts` › `judge`.
- **WebKit's YouTube API scripts are relayed.** The player's iframe (`player-iframe`) needs only `iframe_api` and the `www-widgetapi.js` it names; WebKit fetches them through Playwright's network stack (`engines/browser.ts` › `open`), as the smoke test does for the API's reads. In one full check (2026-10-27) every WebKit player page for about 3 minutes, retries included, never got its iframe in 30 s, while the same views had it in about 5 s earlier in that run; on its own the page had it in 0.9 s, and in 1.5 s under a load of 32. Load doesn't explain a 30 s wait, so the wait wasn't scaled with it.
- A lock or slot file whose process is gone counts for nothing. Checks from before slots held the exclusive lock for their whole run under the name `check`; audits don't wait for such a holder, timing work does.

## Looking at one page: `views.ts`

```sh
bun harness/views.ts /v/6rG_irmOQsM                            # this working tree's production build, in all views
bun harness/views.ts /v/6rG_irmOQsM --compare origin/staging   # before/after, one row per view; a git ref is built
bun harness/views.ts /about --compare https://synbox.io        # before from a URL or origin (the page's path is added)
bun harness/views.ts / --port 5174                             # a server already running (`wt serve`)
bun harness/views.ts /privacy --state search-button            # with an opened state open, in the views it names
```

Each view gets the same audit `check` runs (`probes/layout.ts` › `auditPage`, `pageAt`: it waits for the page as its route's audit does, `/` as home, and uses the same safe areas and installed emulation), and one line per view: `ok`, or the counts over 0 and the offending elements. It writes `.reports/YYYY-MM-DD-views-<slug>/index.html`, the screenshots side by side on a dark page (one row per view with `--compare`), prints its path, and exits 3 when a view has a finding. Without `--port`, the build is served the way `check` serves it, with the same replayed API data.

## The lyrics' clock: `clock-lag.ts`

```sh
bun harness/clock-lag.ts sOiMD45QGLs                           # desktop Chromium, on https://synbox.io
bun harness/clock-lag.ts sOiMD45QGLs --view pwa-landscape --origin http://localhost:5174
```

Plays a song with `?timingProbe=1` and reads the YouTube iframe's own `<video>.currentTime` beside the fill clock on one timeline: how far the clock trails the video, before `stage-lyrics.tsx` › `LYRICS_LEAD_SEC`. Run it before retuning the lead. Audio output latency (Bluetooth) and the display's delay are not in it; those need a phone.

## On a deployed copy: `smoke.ts`

```sh
bun harness/smoke.ts https://deploy-preview-335--synbox.netlify.app   # a deploy preview of staging
bun harness/smoke.ts https://synbox.io                                 # production
bun harness/smoke.ts https://synbox.io --song impSuIygMiQ              # a chosen library song instead of the first with karaoke
bun harness/smoke.ts --local                                          # this checkout, built and served here: no build minutes
```

**`--local`** (`harness/local-site.ts`) builds the checkout for production (`bun run build`, with netlify.toml's `[build.environment]` and the main checkout's env file, and never `SENTRY_AUTH_TOKEN`), copies what Netlify deploys (`dist/`, `netlify/`, `netlify.toml`) to a temporary folder and serves it with `netlify-cli dev` (pinned `27.14.2`, `--dir dist`, `#static`): the Netlify functions, the `/v/*` Edge Function, netlify.toml's redirects (the `/api` proxies to the live Worker, the SPA fallback) and headers, exactly as configured. A small proxy in front finishes any request a browser drops, because netlify-cli exits on an aborted request. The copy is outside `~/github-workspace`, whose stray `package.json` makes netlify-cli serve the wrong folder. Not covered locally, so only a deploy preview shows them: variables set in Netlify's UI, the CDN cache, and HTTPS (HSTS is checked as a header only). `bun harness/local-site.ts` serves this checkout the same way until Ctrl-C; its output goes to `$TMPDIR/synbox-local-site.log`.

Each flow runs in all views (web, PWA portrait, PWA landscape; the views side by side, flows one after another in each, a fresh browser context per flow), against the site's real backends. Songs are picked from the live data when the run starts: the first `karaoke: true` song in `/api/library/songs`, a word of its title (Japanese first, `【…】` tags and words like "feat" or "cover" skipped), the first song of the YouTube Top 100 Japan chart that is not in the library, and the first of two public non-song videos (`jNQXAC9IVRw`, `aqz-KE-bpKQ`) in neither. A pick that can't be made fails its flows with `precondition: …`.

| Flow | Passes when |
| --- | --- |
| `home` | `/api/library/songs` answers 200 with songs; the hero input, a Recommendations slide and the charts show; at least 90% of chart rows show a view count; every gallery card links a song from that list; no `console.error` or uncaught error from the app's own scripts |
| `library-song` | `/v/<id>`: the YouTube iframe reaches `ready`, karaoke timing answers 200 from the lookup service, playback starts, lyrics lines render, a sung part's fill (`--p`) grows between two looks a second apart (the player's ArrowRight skips an intro 5 s a press, up to a minute), and exactly one listen POST is sent |
| `search` | `/search?q=<word>`: once the results hold still for 1.5 s, the song is among them and every result carries the karaoke mic |
| `chart-song` | `/v/<chart id>` plays; the watch page shows "No Lyrics Yet"; Generate Lyrics sends `/generation-check` `{id, kind: "new"}` (answered yes), then `/validate` for that id (answered with the backend's error line), and the app shows that stop; no listen |
| `not-a-song` | `/v/<id>` says "Not on Synbox", holds no YouTube iframe after 3 s, and writes nothing (Sentry's session pings aside) |
| `reader-versions` | `/lyrics/<id>` shows at least 5 lines and asks the lookup service for karaoke timing; `/v/<id>/versions` shows a guest the 403 page, and that service refuses a guest the versions list (401 or 403; asked on deployed copies only) |
| `sign-in` | `/api/me` answers 200 with no user; Sign In sends `/api/auth/sign-in/social` with `provider: google` (answered) and the page goes to accounts.google.com (answered with a blank page) |
| `security-headers` | `/` and `/v/<id>` carry every header in `netlify/security-headers.ts` as written; HSTS needs only its directives, since Netlify sends its own (with `preload`) on `*.netlify.app` |
| `csp` | no `securitypolicyviolation` event and no CSP console message from the site's own documents, in any flow or view |
| `no-writes` | no write reached Synbox's services unanswered |

**Read-only, enforced at the network layer.** Every POST, PUT, PATCH and DELETE to the site's origin (the auth Worker behind `/api`), `*.synbox.io`, Appwrite, Sentry and the Cloud Run services is caught by a Playwright route before it leaves. Six are expected and answered in place (`smoke.ts` › `WRITE_RULES`): the listen, the usage events, Sentry's envelopes, `/generation-check`, `/validate` and the Google sign-in start. Anything else is blocked and fails `no-writes` with its method, URL, view and flow; add a rule only with what that write would have changed. Service workers are blocked, since a route never sees what one fetches. A deploy preview's Netlify Drawer (`/.netlify/scripts/`) is blocked as Netlify's, not the app's. Google Fonts come from the bench's local copy, as in `check`.

**WebKit's reads from `api.synbox.io` are relayed, on every origin.** In the PWA views, GETs to the auth Worker's own host are fetched by Playwright and handed to the page (`smoke.ts` › `runFlow`); writes still go to the guard. macOS WebKit speaks QUIC to that host from its first request (its DNS HTTPS record offers h3). Through this machine's VPN tunnel the first exchange on that connection answers and every later one gets nothing, with no fallback. The app's lyrics and karaoke reads are a preflight and then the GET, so before this the player, Not on Synbox and reader flows timed out in the PWA views only, on code that passed (2026-10-27). The transport is still measured, apart: the `INFO webkit-api` line times two reads in a row over WebKit's own connection. It never fails the run. A stalled second read there means the machine's network, not the site. "N document loads" in a failed flow's evidence counts real document loads, with their paths; history updates are not loads.

Every other browser the harness opens (`engines/browser.ts` › `open`: `check`'s audits, `views.ts`, probes) answers the listen and usage-event POSTs in place too, so no bench run adds listens or events to the live numbers. Each run is a fresh browser, so a new guest device: before this, the bench's player song gained about 2,200 listens. A one-off script that opens Playwright directly instead of `open` must do the same.

It never covers: a real sign-in (the Google round trip and the session it makes), a counted listen (the Worker's write), a paid generation (anything past `/validate`), an admin's versions list, and anything a signed-in user sees. A flow that fails because this machine lost its connection (`ERR_INTERNET_DISCONNECTED` and the like) runs once more, and its line says so. Each run writes `.reports/YYYY-MM-DD-smoke-<host>/` in the main checkout: `index.html` (every flow and view with its evidence, every answered write, every violation, a screenshot of each failure) and `result.json`.

## Shipping: staging, then one release

Finished work is merged into `staging`, never into `main`. `bun harness/release.ts` ships everything in staging as one merge to `main`, which is one Netlify build. The global hook blocks every other way into `main`: a PR into it, a merge into it and a push to it.

```sh
bun harness/release.ts --dry-run   # what staging would ship
bun harness/release.ts --preview   # one deploy preview of staging, smoke-tested, for a phone check; merges nothing
bun harness/release.ts             # check, local smoke, PR staging → main, deploy preview + smoke, merge, live, smoke live: 2 builds
bun harness/release.ts --no-preview  # the same without the deploy preview, once the local smoke passed: 1 build
bun harness/smoke.ts --local       # the smoke alone, on a local production build: no builds
bun harness/smoke.ts <url>         # the smoke alone, on any deployed copy
```

A release, in order, each step stopping it on a failure (fix it in a PR into staging and release again):

1. `check --full` on staging's tree, every time: every audit, whatever each PR's scope was (per-PR verdicts judged other trees). A reused verdict stops the release. The evaluator guard judges each PR merged since `main` on its own (`check.ts` › `guardRanges`), since staging's own diff is empty there. Skipped only when nothing in `harness/gate.json` › `paths` (which include `netlify.toml`, the tsconfigs and `scripts/`) differs from `main`. Four to eight minutes, with other sessions' checks running.
2. `harness/smoke.ts --local` on staging's tree: a production build served by Netlify's runtime here (about 45 seconds). A FAIL stops the release before any PR or build: no build minutes spent. It caught the 2026-10-25 #414 chart-song failure and the missing `/api/events` and `/api/contact` proxies (#458) with no build.
3. The PR staging → main, opened or reused.
4. A deploy preview of staging's tip (skipped with `--no-preview`, which saves one build): an empty `[preview]` commit pushed to staging (`scripts/netlify-ignore.sh` builds previews only for those), then the PR's commit status from Netlify is polled until the preview is ready, up to 15 minutes. A failed build stops the release with its log link; `bunx netlify-cli build --offline --context deploy-preview` in a copy of staging reproduces it (this is how #336's Edge Function import was found).
5. `harness/smoke.ts` from staging's tree on the preview (about 40 seconds; "On a deployed copy" above). A FAIL stops the release before anything is merged. The preview uses the production backend: a failure caused only by backend changes not yet released means releasing the backend first.
6. The merge, then the wait until https://synbox.io serves it.
7. `harness/smoke.ts` on https://synbox.io. The release is already live, so a FAIL can't stop it: it prints a loud warning with the way back (Netlify › Deploys › the previous production deploy › Publish deploy, instant; then `git revert -m 1 <merge>` in a PR into staging and a release) and exits 1.

`--preview` runs steps 1 to 5 and prints the smoke verdict with the link. Each run prints how many Netlify builds it will spend after the local smoke. One release runs at a time on a machine (a lock in `.harness/release/`). A release that changes only docs, the harness, scripts or Markdown costs no Netlify build (`scripts/netlify-ignore.sh`).

## Timing: `trend`

```sh
bun harness/bench/cli.ts trend --reference origin/main         # first run: pin the reference commit (a release you trust)
bun harness/bench/cli.ts trend                                 # origin/main against the pinned reference
bun harness/bench/cli.ts trend --only home --ref origin/staging
```

It builds both commits, serves both at once, and alternates them sample by sample (reference, candidate, candidate, reference, …), at least 12 samples a side, each side warmed up once. A machine that slows down mid-run slows both sides alike. Per metric: Mann–Whitney U, Holm-corrected across a benchmark's gated metrics, and a change must also exceed `max(floor, pct × reference)` (set per metric in `suite.ts`). A metric is `inconclusive`, never `unchanged`, when it has no samples on a side, or when it is underpowered: even the most extreme split of its sample counts would give a Holm-adjusted p of at least 0.05.

The report lands in `.harness/bench/runs/trend-<time>/report.md` and one line per run is appended to `.harness/queue.md` in the main checkout: `regressed`, `inconclusive` or `unchanged`, with the metrics named. Read the queue, then decide what to do about a regression; the release doesn't wait for it. It waits up to 5 minutes for a quiet machine (load under half the cores) and takes the machine to itself ("Sharing the machine"): it waits for running audits to finish, and audits started meanwhile wait for it. Nothing schedules it; run it after a release, or schedule it yourself.

| Benchmark | Surface | Metrics |
| --- | --- | --- |
| `home` | desktop Chrome, 4× CPU | FCP, LCP, CLS, hero box visible, first typed character, recommendations / charts / gallery ready, Next press, gallery scroll fps, dropped frames, blank tiles, blocking |
| `home-load` | cdp-perf mobile lab (4× CPU, slow 4G) | FCP, LCP, CLS, TBT |
| `player-<id>` (4 songs) | desktop Chrome, 4× CPU | iframe, ready, lyrics data, playback start, pause / resume / seek latency, playback fps, dropped frames |
| `player-load` | cdp-perf mobile lab | FCP, LCP, CLS, TBT |
| `hero-type` | cdp-perf flow, 4× CPU | typing latency and blocking |

`bun harness/bench/cli.ts list` prints every benchmark and which command runs it.

## How the checks stay trustworthy

- **Same data every run.** The bench serves a production build the way Netlify does (brotli, cache headers, the `/api` proxies from `netlify.toml` and the functions' routes). API responses, the lookup service included, and Google Fonts are recorded once and replayed. Only successful responses are recorded. `Math.random` is seeded. Sentry is blocked. To re-record API data, delete `.harness/bench/fixtures/` in the main checkout.
- **Test runs don't wake the lookup service.** It scales to zero and is billed while up, and test runs kept it awake most of the day (2026-10-27). Every browser opened through `engines/browser.ts` › `open` (probes on `wt serve`, `views.ts`, `smoke.ts --local`) and the local site's `/api/library/songs` read the lookup service's answers (direct calls, the gallery's song list, karaoke timing from the Worker) from the same fixtures (`bench/replay.ts`), recording only a read nobody has recorded; a JSON 404 ("not in the library") is recorded too. `SYNBOX_LIVE_LOOKUP=1` sends them live on purpose. The smoke test of a deployed copy (`smoke.ts <url>`) always reads the real services, and only it asks the lookup service for the versions list.
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

## Asks: `asks.ts`

The owner adds asks mid-task, and an approved one (a usage cap on the backend's `/validate`, deferred until the Worker could deploy) was dropped after its blocker cleared. The ledger tracks every ask from the message to the PR that lands it.

```sh
bun harness/asks.ts triage                                          # messages not filed yet, oldest first, with their keys
bun harness/asks.ts new "<the ask>" --from <key> --project frontend   # file one (--status, --pr fe#N, --log <file>, --note)
bun harness/asks.ts link A7 <key>                                   # a follow-up to an ask already filed
bun harness/asks.ts skip <key>                                      # not an ask: a question answered in chat, a reply
bun harness/asks.ts set A7 done --pr fe#401                         # statuses: open in_progress done deferred declined
bun harness/asks.ts set A7 deferred --blocker "needs the Worker deploy" --unblocked-by worker-deployed
bun harness/asks.ts cleared worker-deployed                         # reopens and prints every ask waiting on it
bun harness/asks.ts list [--all] [--project backend]                # deferred (with blockers), in progress, open
bun harness/asks.ts report                                          # the block for final reports and ship questions
bun harness/asks.ts show A7                                         # one ask with its messages
bun harness/asks.ts import <transcript.jsonl>                       # backfill a session's messages
```

- **Capture.** `~/.claude/hooks/capture-asks.py` (a global `UserPromptSubmit` hook) appends every prompt typed in a session whose folder is under `~/github-workspace` to the inbox, queued mid-task messages included; nothing outside it (work repos are in `~/gitlab-workspace`). It skips a bare slash command (`/clear`), task notifications and other sessions' messages, and keeps the first 8000 characters of a long paste. It never blocks a prompt: it prints nothing and a crash lets the prompt through. The folder can't tell synbox from other personal repos, so triage sets the project (`frontend`, `backend`, `both`, `dev-process`, `other`).
- **Backstop.** `triage` and `report` also read on through the transcripts of every session the hook saw, so a message the hook missed is still filed. A message is keyed by its session and text, so one seen twice is filed once.
- **Deferred asks** must name what holds them (`--blocker`) and what clears them (`--unblocked-by`): `worker-deployed`, `backend-released`, `frontend-released`, `appwrite-downgraded`, or `owner` (held, or the owner's to do). `cleared <condition>` reopens every ask waiting on it, so an ask can't sit deferred after its blocker is gone.
- **Private.** The inbox, the transcript findings and `ledger.json` live in the main checkout's gitignored `docs/private/asks/`, shared by every worktree (`SYNBOX_ASKS_DIR` overrides it). Prompts may hold anything: never commit them, and quote an ask in a PR or log entry only as the owner's request, never a pasted secret. The ledger has one writer, this tool, under a lock.
- **From the backend repo**, run it through the release worktree, which `bun harness/release.ts` keeps on staging's tip: `bun ~/github-workspace/synbox-release/harness/asks.ts report`.

## README images: `readme/`

The repository README's seven images, rebuilt after a redesign. Every browser opens through `bench/engines/browser.ts` › `open`, silent and headless, with the bench's recorded fonts (WebKit stalls on the live Japanese font, and the app holds lyrics until it loads).

```sh
bun harness/readme/moments.ts [videoId]                       # short, verified lines: times only, never lyric text
bun harness/readme/capture.ts <dir> scout <videoId> 0 --site <origin>      # the song on its side at each moment, to pick from
# Made for Phones
bun harness/readme/capture.ts <dir>/raw home <videoId> <sec> --site <origin>
bun harness/readme/capture.ts <dir>/raw sideways <videoId> <sec> --site <origin> --other-fit
bun harness/readme/capture.ts <dir>/karaoke sideways <videoId> <start> <end> --karaoke-style --lyrics-size 1.05   # as a clip
bun harness/readme/compose.ts <out.webp> --sideways <png> --home <png> --karaoke <dir> --from <s> --to <s> [--keep]
# Hero, Lyrics Style, Search, generation and the karaoke clip
bun harness/readme/capture.ts <dir>/hero hero <videoId> <start> <end> --site <origin>      # website + upright app, as a clip
bun harness/readme/capture.ts <dir>/raw player <videoId> <sec> --site <origin>             # the same as stills, and Lyrics Style
bun harness/readme/capture.ts <dir>/raw search "<query>" --site <origin>
bun harness/readme/capture.ts <dir>/raw generate <videoId> --site <origin>  # a song not in the library
bun harness/readme/capture.ts <dir>/karaoke karaoke <videoId> <start> <end> --site <origin> [--theater]
bun harness/readme/scenes.ts <dir> [--raw <dir>/raw] [--hero <dir>/hero --hero-from <s> --hero-to <s>] \
  [--karaoke <dir>/karaoke --karaoke-from <s> --karaoke-to <s>] [--keep]
# The same devices as separate pieces, for a page that lays them out itself
bun harness/readme/scenes.ts <out> --portfolio --hero <dir>/hero --hero-from <s> --hero-to <s> \
  --upright <png> --sideways <png>   # window.png + window.json (its clip box), clip/, upright.png, sideways.png
bun harness/readme/colors.ts <out.webp>                        # one row, one card per lyric colour
```

- **Shots come from staging** (`--site` a `wt serve` address), with karaoke, recommendations, search and YouTube reads answered from the deployed services, which the dev server's stand-ins can't reach without the backend's keys.
- **The clips play, at 0.25×,** and are shot as fast as the engine allows (about 14 frames a second of song in WebKit): a pause or a seek brings up YouTube's own centre button and the app's controls. Only the moving region is shot each frame; `base.png` is the rest of the screen. The stills don't seek either (in WebKit the video is still black after one when the line comes): the page opens 30 s before the line, and the shot fails if the song passed it while images loaded.
- **`generate` is staged:** a signed-in test listener (`probes/layout.ts` › `signIn`) and the backend's generation streams answered in the page, held part way through. No request reaches the backend.
- **`--other-fit`** switches the video's fit, for a music video whose own captions the default crop cuts in half. **`--theater`** shoots the karaoke clip in Theater, whose lyrics default to Karaoke Style's two rows.
- **Lyrics stay at the default size and style**, as a first-time listener sees them, unless a shot asks otherwise: `--karaoke-style` stores Karaoke Style as the listener's default before the app loads (two rows on every screen), and `--lyrics-size <n>` its size (0.6 to 1.05 on a phone on its side). The portfolio's sideways phone uses both, so its lyric reads at a small size: `capture.ts <dir>/raw sideways dy90tA3TT1c 144.2 --karaoke-style --lyrics-size 1.05`.
- **Pick moments by eye and by line:** pretty art, and a line that reads well in English. Lyrics stay out of the repo; the images show a line or two, as the app does.

## Known limits

- What the lab can't show: the real iOS keyboard, iOS's zoom into a field under 16px (`zoomInputs` predicts it; WebKit in Playwright never zooms, so `panXPx` only catches a pan the layout itself causes), the status bar's own drawing, and touch drags.
- The hook reads the command text. A command hidden in a wrapper (`bash -c "gh pr merge …"`, a script, `gh api` calls to the pulls endpoints) is not seen. The release script's own `gh` calls rely on this.
- `trend` is not scheduled; nothing runs it unless someone does.

## Requirements

Bun, Google Chrome, Playwright's WebKit (`bunx playwright install webkit`), and, for `trend`, the frontend-perf skill's cdp-perf (`~/.claude/skills/frontend-perf/scripts/cdp-perf`, or set `CDP_PERF`). Builds read the main checkout's env file like `vp build` does; nothing here reads or prints it.
