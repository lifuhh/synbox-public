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

**Check every UI change on three screens**, by measuring positions, not only by looking: desktop Chromium 1440×900, and Playwright WebKit with `isMobile: true, hasTouch: true` at 390×844 and 844×390. Chrome's device mode is not enough (it flips back to `pointer: fine` mid-page and is not WebKit). Playwright reports no safe areas; inject the iPhone ones (portrait top 47 / bottom 34, landscape left and right 47 / bottom 21) by overriding `--safe-top`, `--safe-bottom`, `--safe-left` and `--safe-right` on `:root` (everything that clears the status bar, `--topbar-h` and `pt-safe-top` included, reads `--safe-top`). Put the before/after screenshots side by side in a `.reports/` page. Real-device feel (touch drag, home indicator, status bar) still needs the user's phone: say what was not checked.

## Shipping a change

Every task goes worktree → branch → PR without asking how. Merging to `main` is the deploy, and every Netlify build (production or preview) spends the account's monthly build minutes, so builds are rationed:

- **A batch ships as one merge to `main`.** A request with several pieces of work (or one heavy piece) gets an integration branch, `integrate/<batch>`, cut from `origin/main`. Each piece is its own branch and PR with `--base integrate/<batch>`, merged into it after review; Netlify builds nothing for these (it only builds `main` and PRs against `main`). When the batch is done, one PR `integrate/<batch>` → `main` carries it, and merging that is the single deploy. A lone small fix may go straight to `main`.
- **Previews are opt-in.** `netlify.toml › build.ignore` runs `scripts/netlify-ignore.sh`, which skips every deploy preview unless the head commit's message contains `[preview]`. Verify locally first (step 3). Ask for a preview only when the user must try it on a phone, once per batch, e.g. `git commit --allow-empty -m "Build a preview [preview]"` on the integration branch.

1. **Start in your own worktree**, never in the main checkout (other sessions and the private log live there): `git -C <main checkout> fetch origin && git -C <main checkout> worktree add ../synbox-<slug> -b <type>/<slug> origin/<base>`, type one of `feat` `fix` `chore` `docs` `perf`, base `main` or the batch's `integrate/<batch>`. One task, one worktree, one branch, one PR. Then record who owns it, so other sessions can reach you (Claude Code: your name is the first line of `ListAgents`): `echo <session name> > "$(git rev-parse --path-format=absolute --git-dir)/agent-session"`.
2. **Run it.** `bun install` (and `cd worker && bun install`: the auth Worker has its own packages, and lint reads its tsconfig), then `bunx vp dev --port 5173 --strictPort`. The dev server reads the main checkout's env file (`envDir` in `vite.config.ts`); don't copy it into the worktree. Other sessions often hold ports: check with `lsof -nP -iTCP:<port> -sTCP:LISTEN` and pick another if taken. On ports other than 5173 the page and lyrics work but `/api/youtube` gets 403, because the local YouTube key only allows known localhost referrers. Karaoke timing calls the local backend (`VITE_SYNBOX_BE_URL`) and fails while it isn't running.
3. **Check:** `bun run typecheck`, `bun run test`, `bun run fmt:check`, `bun run lint`, then the change itself in a real browser.
4. **Commit, push and open the PR without asking.** Read the staged diff and the PR body against the rules above first. `gh pr create --base <main or integrate/<batch>>`. A piece of a batch is merged into its integration branch once reviewed (`gh pr merge <n> --merge`); that deploys nothing. A preview, when one was asked for with `[preview]`, is at `https://deploy-preview-<n>--synbox.netlify.app`; hand the user that link.
5. **Deploy when the user says deploy, ship or merge.** Rebase if `main` moved (see below), wait for green checks, `gh pr merge <n> --merge` (for a batch: the integration PR, once). Netlify builds production from `main` and serves https://synbox.io a few minutes later. It posts no status on the commit, so check the live bundle for the merge commit (the build stamps it in as the Sentry release); repeat until it prints `live`:
   ```sh
   sha=$(git rev-parse origin/main); js=$(curl -s https://synbox.io/ | grep -o '/assets/index-[^"]*\.js' | head -1)
   curl -s "https://synbox.io$js" | grep -q "$sha" && echo live || echo 'not yet'
   ```
6. **Clean up** after the merge: `git worktree remove ../synbox-<slug>` and `git branch -D <type>/<slug>`.

This repo is the frontend only. The backend (`synbox-transcribe-whisper`) deploys separately to Cloud Run; merging here never deploys it.

## Resolving conflicts

- **Rebase, don't merge `main` in:** `git fetch origin && git rebase origin/main`, then `git push --force-with-lease`. The PR that merges second does the rebasing.
- **Learn what the other side meant before editing a hunk.** `git log origin/main -p -- <file>` gives the commit; `gh pr list --state merged --search <sha>` gives its PR; read the PR description and its private log entry. Keep both intents, with merged `main` as the baseline you adapt to. Then rerun the checks and look at both changes in the browser, not just yours.
- **When the other side is unmerged work in another worktree and the intents clash, ask its session.** `git worktree list` maps the branch to its worktree; `cat "$(git -C <worktree> rev-parse --path-format=absolute --git-dir)/agent-session"` names the session; `ListAgents` shows whether it is still alive. `SendMessage` it the files, both intents, your proposed resolution and who rebases, then wait for its answer. Silence is not agreement. Never ask a peer to do something your own session was refused.
- **If the owner is gone or never answers**, resolve from its PR description and log entry. Ask the user only when the two intents are opposite product decisions.
