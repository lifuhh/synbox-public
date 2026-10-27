// Docs-only commits keep the verdict they follow. A change-log entry or a README edit can't change what `check`
// judges, so a commit that changes only docs after a passing verdict is stamped with that verdict instead of a
// new run. The PR hook (~/.claude/hooks/harness-gate.py › is_docs) applies the same rule.

import { execFileSync } from 'node:child_process'

import { readVerdict } from './store'
import type { Repo } from './store'
import type { Verdict } from './types'

/** Prose that nothing builds, serves or audits: anything under docs/, and Markdown outside src/ and public/ */
export const isDocs = (file: string): boolean =>
  file.startsWith('docs/') ||
  (file.endsWith('.md') && !/^(?:src|public)\//u.test(file))

const REUSE_DEPTH = 20

const git = (top: string, ...args: string[]): string =>
  execFileSync('git', ['-C', top, ...args], { encoding: 'utf-8' }).trim()

/**
 * This tree's own passing verdict, or that of the nearest first-parent ancestor (up to REUSE_DEPTH back) whose diff
 * to HEAD is docs only. Uncommitted changes never reuse anything.
 */
export const reusableVerdict = (
  repo: Repo
): { verdict: Verdict; files: string[]; from: string } | null => {
  if (repo.dirty) {
    return null
  }
  const own = readVerdict(repo)
  if (own?.status === 'pass') {
    return { files: [], from: repo.sha, verdict: own }
  }
  for (let depth = 1; depth <= REUSE_DEPTH; depth += 1) {
    let sha: string
    try {
      sha = git(repo.top, 'rev-parse', '--verify', '--quiet', `HEAD~${depth}`)
    } catch {
      return null
    }
    const files = git(repo.top, 'diff', '--name-only', sha, 'HEAD')
      .split('\n')
      .filter(Boolean)
    if (!files.every(isDocs)) {
      return null
    }
    const verdict = readVerdict(
      repo,
      git(repo.top, 'rev-parse', `${sha}^{tree}`)
    )
    if (verdict?.status === 'pass') {
      return { files, from: sha, verdict }
    }
  }
  return null
}
