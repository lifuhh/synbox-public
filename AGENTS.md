# Agent Notes

- **Never commit anything sensitive.** This repo is open source: every commit, commit message, branch, PR description and PR comment is public as soon as it is pushed, and stays in history after it is deleted. Sensitive means:
  - secrets, API keys, tokens, cookies, `.env` contents, service-account files;
  - personal data: emails, real names of private people, account ids;
  - lyrics text and song audio (copyrighted; song titles and video ids are fine);
  - the private change log (`docs/log/`) and session transcripts;
  - open security weaknesses in production (for example storage or database permissions that are too open), until they are fixed;
  - internal details of any employer.

  Before every commit, read the staged diff and the message for these. Before every PR, read its description the same way. When unsure, leave it out and ask.

- **Keep the private change log, never commit it.** `docs/log/` in the main checkout is gitignored working history: one entry per PR (problem, cause, change, expected behaviour, judgment calls, verification), in the shape set by its local `README.md`. From a worktree, write to `"$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/docs/log/"`. Before changing how something works, read its entries (`grep -l <area or song id> docs/log/*`) so an earlier fix is not undone. If the folder is missing (a fresh clone), skip the log; never recreate it as tracked files.
- Local reports and visual write-ups (HTML summaries, before/after screenshots, measurements) go in `.reports/YYYY-MM-DD-<slug>/`, one folder per report: an `index.html` with its images beside it, referenced by relative path so it opens offline. `.reports/` is gitignored; never commit a report. Anything worth keeping about why a change was made goes in the private change log instead.

## Phones, the installed app and desktop

The installed app (PWA) and the website are the same build: there is no phone code path to keep in sync. When they look different, the cause is one of two things, and every UI change must account for both:

- **The engine.** Every iPhone browser and the installed iOS app run WebKit; desktop is usually Chromium. The same CSS lays out differently. Known cases, each fixed once in `src/globals.css`:
  - Furigana: Chromium stands an `<rt>` on the kanji's line box, WebKit above the font's full ascent (0.34em higher). `lyric-ruby-text`'s negative margin puts both at the same spot.
  - Flex: an empty spacer with a `min-height` and no `flex-basis` gets its min-height as the basis in WebKit, so it grows past it. Spacers that share space (`anchor-spacer`, `lyrics-lift`) set `flex-basis: 0`.
  - iOS clips a `filter` on an inline box and paints no text-clipped background on `<rt>` (see `lyric-karaoke-line` and the karaoke fill spans); iOS keeps the last tapped element in `:hover`, so touch never reads `:hover`.
- **The screen class.** A phone on its side is wide (~850px) but only ~390px tall. A value keyed only to width (`cqw`, `width < 40rem`) sizes it like a monitor. Key phone rules to the device, not one axis: `touch:` (finger input), `short:` (phone on its side), `portrait:`, and cap width-based sizes by height (`min(2cqw, 4cqh)`). The same pixel gap or dock distance is a finger's width on a phone and nothing on a monitor: use a share of the space instead.

Rules for the player (and any full-screen surface):

- **One measure for what the floating UI covers.** `--stage-chrome-h` is the bottom edge the controls (plus, in portrait, the rail) cover while they show. Anything that must clear them reads it, only while they show. Never offset a layer permanently by an element that hides.
- **Presses outside a control go to the stage.** The stage's own taps (show/hide controls, double-tap seek) sit under everything. Don't widen a press target over it: the lyrics take presses only on their drawn text (`lyrics-hit-text`).
- **Input on the floating UI counts as activity.** Don't stop `pointerdown` on it, or the controls hide under a finger that is still tapping them.
- **Keep a dragged thing mounted, and save it on the drop**, not on every move: a remount mid-drag kills the drag, and a storage write per move is jank on a phone.

**Check every UI change on three screens** by measuring, not only by looking: `bun harness/bench/cli.ts check --only layout-<page>` (page names: `bun harness/bench/cli.ts list`) audits the page on desktop Chromium 1440×900 and Playwright WebKit iPhone 390×844 (Safari and the installed app) and 844×390, with iPhone safe areas injected, and prints each too-small, covered, cut-off or inset-trapped press target with its box, plus the folder of screenshots. A new route with parameters needs a sample URL in `harness/routes.json`, in the same PR; elements marked `data-bench` are the audits' hooks, so keep the attribute on whatever replaces them. Chrome's device mode is not a substitute (it flips back to `pointer: fine` mid-page and is not WebKit). Report the measurements; a side-by-side before/after `.reports/` page is only for when the user asks, or for a big restructure or a new feature (screenshots cost tokens). Keep every driven browser silent: Chromium with `--mute-audio`, and never press Tap to Unmute (hide the pill with injected CSS if it spoils a shot). Real-device feel (touch drag, home indicator, status bar) still needs the user's phone: say what was not checked.

**Measure alignment, every time** (the owner's standing rule). Run the `better-*` skills (`better-interface` covers all of them) over every page a change touches, and measure with the browser, not by eye:

- an icon beside a label or a number (a tab, a pill, a count) is centred on the control's vertical centre and on the text's centre line, within 1px; a lone icon is centred in its button both ways;
- items in a row share one centre line (or one baseline for text), and a list's rows start at one left edge;
- report the measured offsets with the screenshots. An off-centre glyph that is optically right (a play triangle) is the only exception, and says so.

## Shipping a change

Finished work collects in one long-lived branch, `staging`, and reaches production only through `bun harness/release.ts`, one merge to `main` for everything in staging. Every merge to `main` is a Netlify build, which spends the account's monthly build minutes; staging costs none. The global PR hook enforces this: it blocks a PR into `main`, a merge into `main` and a push to `main` from anything but the release script.

1. **Start in your own worktree**, never in the main checkout (other sessions and the private log live there): `bun harness/wt.ts start <type>/<slug> --session <session name>` (from anywhere in the repo), type one of `feat` `fix` `chore` `docs` `perf`. It fetches, adds `../synbox-<slug>` on a new branch from `origin/staging`, records who owns it so other sessions can reach you (Claude Code: your name is the first line of `ListAgents`), and installs the app's and the auth Worker's packages. One task, one worktree, one branch, one PR.
2. **Run it.** In the worktree, `bun harness/wt.ts serve`, as a background task: it takes the first free port from 5173 and prints the address. Stop it by stopping that task, never by killing a process by name or port (other sessions' servers and browsers run beside yours). Run probes and other one-off scripts in the foreground with a timeout, so nothing is left to kill. The dev server reads the main checkout's env file (`envDir` in `vite.config.ts`); don't copy it into the worktree. On ports other than 5173 the page and lyrics work but `/api/youtube` gets 403, because the local YouTube key only allows known localhost referrers. Karaoke timing calls the local backend (`VITE_SYNBOX_BE_URL`) and fails while it isn't running.
3. **Check:** commit, then `bun harness/bench/cli.ts check` (about 35 seconds: typecheck, lint, tests, format, size budgets, layout audits of every route on three screens; `harness/README.md` says what to do when it fails), then look at the change itself in a real browser. The PR hook requires its passing verdict for the branch's committed tree. Staging holds only finished work: anything merged there can go live at the next release, from any session.
4. **Commit, push, open the PR into staging and merge it yourself, without asking:** read the staged diff and the PR body against the rules above, `gh pr create --base staging`, then `gh pr merge <n> --merge`. Nothing deploys. Work that isn't finished stays on its branch.
5. **When the user's request is done, ask one question, the only one about shipping.** Run `bun harness/release.ts --dry-run`, which lists everything in staging (every session's, not only yours). Then ask with AskUserQuestion: "Ship staging to live now?", the list in the question, options **Ship Now** and **Leave in Staging**. Skip the question when staging has nothing to ship.
   - **Ship Now**, or the user saying ship, deploy, release or merge at any time: `bun harness/release.ts`. It takes a lock, so only one release runs on the machine. It runs `check` on staging's combined tree (about 35 seconds), opens and merges the PR staging → main, and waits until https://synbox.io serves the merge. It stops on a failing check; fix it in a PR into staging and run it again.
   - **Leave in Staging**: the session is done. The work ships with the next release.
   - **The user must try it on a phone first:** `bun harness/release.ts --preview` builds one deploy preview of staging and prints its link. Hand the user the link; ship when they say so.
6. **Clean up** after the merge into staging: stop your `serve` task, then `bun harness/wt.ts finish <slug>`. It copies the worktree's `.reports/` into the main checkout's, removes the worktree and deletes the branch. It refuses, and says why, while there are uncommitted changes, the branch is not in staging, or its dev server still runs; never force past it (`--force`, `-D`, `rm -rf`).

This repo is the frontend only. The backend (`synbox-transcribe-whisper`) ships the same way, with its own staging branch and `python3 harness/release.py` (Cloud Run); merging here never deploys it. A request that changed both repos still asks one question, listing both stagings; Ship Now runs both releases, the backend's first when the frontend depends on it.

## Resolving conflicts

- **Rebase, don't merge `staging` in:** `git fetch origin && git rebase origin/staging`, then `git push --force-with-lease`. The PR that merges second does the rebasing.
- **Learn what the other side meant before editing a hunk.** `git log origin/staging -p -- <file>` gives the commit; `gh pr list --state merged --search <sha>` gives its PR; read the PR description and its private log entry. Keep both intents, with merged `staging` as the baseline you adapt to. Then rerun the checks and look at both changes in the browser, not just yours.
- **When the other side is unmerged work in another worktree and the intents clash, ask its session.** `git worktree list` maps the branch to its worktree; `cat "$(git -C <worktree> rev-parse --path-format=absolute --git-dir)/agent-session"` names the session; `ListAgents` shows whether it is still alive. `SendMessage` it the files, both intents, your proposed resolution and who rebases, then wait for its answer. Silence is not agreement. Never ask a peer to do something your own session was refused.
- **If the owner is gone or never answers**, resolve from its PR description and log entry. Ask the user only when the two intents are opposite product decisions.
