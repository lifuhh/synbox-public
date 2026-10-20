# Agent Notes

- This repo is public. Never commit secrets or `.env`.
- Every PR adds a change-log entry, `docs/log/YYYY-MM-DD-<branch>.md`, in the same PR. Shape and rules: `docs/log/README.md`. Write it while the work is fresh: problem, cause, change, expected behaviour, judgment calls (the alternatives that lost and why), verification. Before changing how something works, read its entries (`grep -l <area or song id> docs/log/*`) so an earlier fix is not undone.
- Local reports and visual write-ups (HTML summaries, before/after screenshots, measurements) go in `.reports/YYYY-MM-DD-<slug>/`, one folder per report: an `index.html` with its images beside it, referenced by relative path so it opens offline. `.reports/` is gitignored; never commit a report. Anything the repo should keep belongs in `docs/log` instead.
