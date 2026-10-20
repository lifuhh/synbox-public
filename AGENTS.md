# Agent Notes

- This repo is public. Never commit secrets or `.env`.
- Every PR adds a change-log entry, `docs/log/YYYY-MM-DD-<branch>.md`, in the same PR. Shape and rules: `docs/log/README.md`. Write it while the work is fresh: problem, cause, change, expected behaviour, judgment calls (the alternatives that lost and why), verification. Before changing how something works, read its entries (`grep -l <area or song id> docs/log/*`) so an earlier fix is not undone.
- Local reports and visual write-ups (HTML summaries, before/after screenshots, measurements) go in `.reports/YYYY-MM-DD-<slug>/`, one folder per report: an `index.html` with its images beside it, referenced by relative path so it opens offline. `.reports/` is gitignored; never commit a report. Anything the repo should keep belongs in `docs/log` instead.

## Shipping a change

Every task goes worktree → branch → PR → preview without asking how. Merging to `main` is the deploy.

1. **Start in your own worktree**, never in the main checkout (other sessions and the private log live there): `git -C <main checkout> fetch origin && git -C <main checkout> worktree add ../synbox-<slug> -b <type>/<slug> origin/main`, type one of `feat` `fix` `chore` `docs` `perf`. One task, one worktree, one branch, one PR. Then record who owns it, so other sessions can reach you (Claude Code: your name is the first line of `ListAgents`): `echo <session name> > "$(git rev-parse --path-format=absolute --git-dir)/agent-session"`.
2. **Run it.** `bun install`, then `bunx vp dev --port 5173 --strictPort`. The dev server reads the main checkout's env file (`envDir` in `vite.config.ts`); don't copy it into the worktree. Other sessions often hold ports: check with `lsof -nP -iTCP:<port> -sTCP:LISTEN` and pick another if taken. On ports other than 5173 the page and lyrics work but `/api/youtube` gets 403, because the local YouTube key only allows known localhost referrers. Karaoke timing calls the local backend (`VITE_SYNBOX_BE_URL`) and fails while it isn't running.
3. **Check:** `bun run typecheck`, `bun run test`, `bun run fmt:check`, `bun run lint`, then the change itself in a real browser.
4. **Commit, push and open the PR without asking.** Read the staged diff and the PR body against the rules above first. `gh pr create --base main`, then `gh pr checks <n> --watch`: Netlify builds a preview at `https://deploy-preview-<n>--synbox.netlify.app`. Hand the user that link.
5. **Deploy when the user says deploy, ship or merge.** Rebase if `main` moved (see below), wait for green checks, `gh pr merge <n> --merge`. Netlify builds production from `main` and serves https://synbox.io a few minutes later. It posts no status on the commit, so check the live bundle for the merge commit (the build stamps it in as the Sentry release); repeat until it prints `live`:
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
