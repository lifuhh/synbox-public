#!/usr/bin/env bash
# Netlify's build.ignore: exit 0 skips the build, exit 1 runs it.
# - Production (main): builds, unless nothing the site is built from changed since the last deploy: a release of
#   only docs, the harness, scripts or Markdown spends no build minutes. harness/release.ts keeps the same list.
# - Deploy previews: build only when the head commit asks with [preview], so pushes to a PR cost no build minutes.
if [ "$PULL_REQUEST" != "true" ] && [ "$CONTEXT" != "deploy-preview" ]; then
  if [ -n "$CACHED_COMMIT_REF" ] && [ "$CACHED_COMMIT_REF" != "$COMMIT_REF" ] &&
    git diff --quiet "$CACHED_COMMIT_REF" "${COMMIT_REF:-HEAD}" -- . \
      ':(exclude)docs' ':(exclude)harness' ':(exclude)scripts' ':(exclude)*.md' ':(exclude).claude'; then
    echo "Production build skipped: only docs, the harness, scripts or Markdown changed since the last deploy"
    exit 0
  fi
  exit 1
fi
if git log -1 --format=%B "${COMMIT_REF:-HEAD}" | grep -qF '[preview]'; then
  exit 1
fi
echo "Deploy preview skipped: no [preview] in the head commit message"
exit 0
