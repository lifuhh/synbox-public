# What's New

Listeners read what changed on the What's New page (`/whats-new`), from the profile menu, the You page, the bell and the "Updated · See What's New" note after an update. That note links here only while the newest entry is unread by this listener (a release with no entry of its own says just "Updated" to someone who read the last one; someone back after several releases still gets the link). Every release that changes anything a listener sees gets an entry. Write it in the same PR as the change, or in the last PR before the release.

## Where entries live

`src/lib/whats-new/entries.json`, newest first:

```json
{
  "id": "smoother-starts",
  "date": null,
  "title": "Smoother Starts",
  "items": ["…"]
}
```

- `id`: lowercase words joined by `-`, unique. The bell and links use it (`/whats-new#smoother-starts`).
- `date`: `null` for the entry the next release ships. `bun harness/release.ts` stamps it with the ship date (this machine's calendar) and pushes that to staging before its check. An entry already dated the ship day ships as it is. Never type a future date.
- `release.ts` stops before anything runs when staging changes `src/`, `public/` or `index.html` (the entries file aside) and the top entry is neither undated nor dated today; it prints the entry to add. `--dry-run` prints the entry that would ship.
- One undated entry at most, always at the top. A PR that adds to the next release adds lines to that entry instead of starting another.
- `title`: Title Case, 2 to 4 words, what the release is about for a listener.
- A release that only fixes and speeds things up gets the single line `Bug fixes and performance improvements` (`BUG_FIXES` in `src/lib/whats-new/model.ts`).

## What goes in

Only what a listener would notice and care about, in their words. Use common sense: if they wouldn't miss it, leave it out.

Never:

- **Developer words:** sync, PWA, iframe, 1080p, cache, audit, harness, check, bench, API, worker, backend, deploy, span, doc, stage names.
- **Accounts:** limits, quotas, usage logging, counting or tracking.
- **Admin-only changes:** the admin page, reports review, notices for the admin.
- **Internals:** tests, tooling, the change log, performance budgets, refactors.
- **What was wrong, from the inside:** say what works now, not which bug caused it.

## How to write a line

- One short line per change, sentence case, no full stop at the end. Two short sentences are fine when one can't say it.
- Say what the listener gets: "Playback Speed: 1×, 0.75×, 0.5×", not "Added a playback speed feature".
- Name controls as the app names them (Text Style, Lyrics Style, Generate Lyrics).
- Curly quotes and apostrophes (’ “ ”).
- No hype: no "seamless", "powerful", "exciting", "we're thrilled", and no exclamation marks.
- Before writing a line, check the change does what the line says, in the app. A line that describes the wrong design is worse than no line.

## Examples

| Bad | Why | Good |
| --- | --- | --- |
| Lyrics that share a translation are grouped, with the translation shown once | Described a design that wasn't the ask | Shared translations show under every line in the lyrics reader |
| Lyrics panel follows sync more smoothly | Developer word ("sync") | The lyrics follow the song more smoothly |
| Sharper video: 1080p iframe on phones | Developer words | Sharper video on phones |
| One free song per guest, 5 a day signed in | Limits and quotas | (left out) |
| Admin Songs list shows why a song failed | Admin only | (left out) |
| Generate Lyrics' check waits 60 s for a cold backend | Internals | No more "Couldn’t reach Synbox" on your first song of the day |
| Fixed flaky player audits | Tooling | (left out) |
