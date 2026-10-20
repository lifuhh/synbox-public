# Agent Notes

- This repo is public. Never commit secrets or `.env`.
- Every PR adds a change-log entry, `docs/log/YYYY-MM-DD-<branch>.md`, in the same PR. Shape and rules: `docs/log/README.md`. Write it while the work is fresh: problem, cause, change, expected behaviour, judgment calls (the alternatives that lost and why), verification. Before changing how something works, read its entries (`grep -l <area or song id> docs/log/*`) so an earlier fix is not undone.
