// The evaluator is read-only to the work it judges. A branch that changes how the app is judged and the app in one
// go could pass by moving the goalposts, so `check` refuses it: land evaluator changes in their own PR, judged
// against an unchanged app. The evaluator is everything that decides what `check` runs and how it judges: the
// bench (all of harness/bench/ except trend.ts, which never gates), package.json's scripts (`check` runs them),
// the release script and gate.json (they decide whether `check` runs at all), and the flow smoke test (harness/smoke.ts),
// which the release runs on the deploy preview before it ships. Budgets (harness/budgets.json) and
// the route list (harness/routes.json) are not: raising a budget or adding a route beside the change that needs it
// is the intended, visible way to accept it.

const EVALUATOR =
  /^(?:harness\/bench\/(?!trend\.ts$)|package\.json#scripts$|harness\/release\.ts$|harness\/smoke\.ts$|harness\/gate\.json$)/u
// What ships. Dependencies count through bun.lock
const APP =
  /^(?:src\/|public\/|index\.html$|vite\.config\.ts$|bun\.lock$|netlify\/)/u

/**
 * `changed` is the branch's files, with package.json as `package.json#scripts` when its scripts changed (check.ts).
 * `onBase` says whether a file existed at the base: adding an evaluator file is not editing one.
 */
export const evaluatorTouched = (
  changed: string[],
  onBase: (file: string) => boolean
): string | null => {
  const evaluator = changed.filter((f) => EVALUATOR.test(f) && onBase(f))
  const app = changed.filter((f) => APP.test(f))
  return evaluator.length > 0 && app.length > 0
    ? `this branch changes the evaluator (${evaluator.join(', ')}) and the app (${app.length} files) together; split the evaluator change into its own PR`
    : null
}
