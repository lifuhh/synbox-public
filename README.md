<p align="center">
  <a href="https://synbox.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/readme/Synbox.svg" />
      <img src="docs/readme/Synbox-light.svg" alt="Synbox" width="300" />
    </picture>
  </a>
</p>

<p align="center">
  <strong>Sing along to Japanese songs on YouTube.</strong>
  <br />
  Lyrics timed to every syllable, with furigana, romaji and an English or Chinese translation.
</p>

<p align="center">
  <a href="https://synbox.io"><strong>Open Synbox</strong></a>
  ·
  <a href="https://github.com/lifuhh/synbox-public/issues">Report a Bug</a>
</p>

<p align="center">
  <img src="docs/readme/showcase/hero.webp" alt="The Synbox player on desktop and iPhone, with karaoke lyrics over the music video" width="100%" />
</p>

Pick a song or paste a YouTube link. The lyrics play over the video and fill as they are sung, with readings and a translation. Synbox runs in the browser and installs on a phone as an app.

This repository is the web app and its auth Worker. The service that makes the lyrics is private.

## Karaoke

<p align="center">
  <img src="docs/readme/showcase/karaoke.webp" alt="A lyric line filling syllable by syllable as it is sung, with furigana, romaji and an English translation" width="100%" />
</p>

- **Timed to every syllable**, like a karaoke machine.
- **Furigana** over the kanji, **romaji** under the line. Each layer turns on and off.
- **English or Chinese.** The whole song is translated at once, so lines read in context.
- **Lyrics panel and reader.** Scroll the full lyrics beside the video, or read them as a page.

## Any Song on YouTube

<p align="center">
  <img src="docs/readme/showcase/generate.webp" alt="Generation progress on desktop and iPhone" width="100%" />
</p>

Paste a link to a song that isn't in the library. Synbox transcribes it and aligns it to its lyrics, word by word: published lyrics when they match, speech recognition when they don't. Progress shows step by step while you browse. The song is saved for everyone. One new song a day is free; signing in gives you more.

## Made for Phones

<p align="center">
  <img src="docs/readme/showcase/phones.webp" alt="Synbox installed on an iPhone: home page, player and lyrics reader" width="100%" />
</p>

<p align="center">
  <img src="docs/readme/showcase/karaoke-phone.webp" alt="Full Screen on an iPhone: the video with one karaoke line under it, filling as it is sung" width="34%" />
</p>

- **Installs as an app** on iPhone and Android, with a tab bar.
- **Full Screen:** the video and one line at a time.
- **Sideways:** the video fills the screen with lyrics on top. Lock Landscape keeps it there.
- **Lock Screen** ignores stray taps until you unlock.
- **Double-tap** to skip 10 seconds.
- **Offline reading** for songs you open, bookmark or generate.

## Your Style

<p align="center">
  <img src="docs/readme/showcase/style.webp" alt="The Lyrics Style panel: size, Two Lines, colour presets and backdrop" width="100%" />
</p>

Size, seven colour presets or your own, and a backdrop that keeps lyrics readable on any video. Two Lines shows the next line early. Styles apply to every song or just one, and follow you across devices when you sign in.

## Find Something to Sing

<p align="center">
  <img src="docs/readme/showcase/search.webp" alt="Search results for &quot;sad song by a female singer&quot;" width="100%" />
</p>

- **Search by description:** "sad song by a female singer" matches mood and voice, read by [TypeSafe's Jev](https://docs.typesafe.ai/api). Titles and artists work in Japanese or romaji.
- **Recommendations and Japan's YouTube Top 100** on the home page.
- **More Like This** under every song: same artist first, then mood, voice and theme.
- **Library:** bookmarks, playlists and history, merged into your account when you sign in.

## Built With

The same groups as the [About page](https://synbox.io/about), with a little more detail.

- **Code:** TypeScript and React on Vite, Tailwind CSS. Python and Flask for the lyrics service. SQL on Cloudflare D1. Better Auth for Google sign-in.
- **AI:** LLMs, speech recognition and NLP make each song's lyrics, readings and translations; evals keep them accurate. TypeSafe's Jev understands searches and tags each song's mood and voice. Agentic coding builds the app.
- **Platforms:** OpenAI, Anthropic Claude, ElevenLabs and TypeSafe for AI. Google Cloud runs the lyrics service, Cloudflare the accounts, Netlify the site, Appwrite the song files. YouTube's embedded player and Data API for video. Sentry for errors.

Security lives in code: a strict Content-Security-Policy, HSTS, rate limits, per-account quotas, and a build that fails instead of shipping source maps.

## How It's Developed

Since October 2026, AI coding agents (Claude Code) write most changes, several at a time. One person sets direction and reviews. Nothing ships without evidence:

- **[`AGENTS.md`](AGENTS.md)** holds the rules every agent follows: what never gets committed, how to build for phones and desktop, how changes ship.
- **One task, one worktree, one PR.** `harness/wt.ts` gives each task its own copy and dev server. Finished work merges into `staging`.
- **Every PR passes `harness/bench/cli.ts check`:** types, lint, tests, formatting, bundle size, and a layout audit of every page on desktop, an iPhone app upright and sideways, iPhone Safari and a 320px screen. The audit catches small or covered buttons, content under the notch, sideways scroll, clipped text, unnamed controls, and buttons that fire on press instead of release. A hook blocks any PR without a passing check.
- **One path to production.** `harness/release.ts` re-checks `staging`, then smoke-tests a local build, a preview deploy and the live site. It stops at the first failure.
- **A written reason for every change.** Each PR gets a private change-log entry: problem, cause, fix, lesson.

## Run It Locally

Requires [Bun](https://bun.sh).

```sh
bun install
cp .env.example .env    # each variable is explained in the file
bunx vp dev
```

Songs and lyrics come from the private backend, so a local copy needs its own services to show them.

## Disclaimer

Synbox is a personal, non-commercial project for enjoying Japanese music videos. Songs, lyrics and videos belong to their rights holders. To have something removed, use **Contact Me** at the bottom of [synbox.io/about](https://synbox.io/about).

## License

[PolyForm Noncommercial 1.0.0](./LICENSE): free to read, run, fork and modify for non-commercial use.
