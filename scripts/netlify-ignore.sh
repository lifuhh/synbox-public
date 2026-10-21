#!/usr/bin/env bash
# Netlify's build.ignore: exit 0 skips the build, exit 1 runs it. Anything that is not a pull request (main's
# production build) always builds; a deploy preview builds only when its head commit asks with [preview], so
# pushes to a PR cost no build minutes
if [ "$PULL_REQUEST" != "true" ] && [ "$CONTEXT" != "deploy-preview" ]; then
  exit 1
fi
if git log -1 --format=%B "${COMMIT_REF:-HEAD}" | grep -qF '[preview]'; then
  exit 1
fi
echo "Deploy preview skipped: no [preview] in the head commit message"
exit 0
