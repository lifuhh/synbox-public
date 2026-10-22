// The evaluator is read-only to the work it judges. A branch that changes how the app is judged (the scorer, the
// metric specs in suite.ts, the probes that measure) and the app in one go could pass by moving the goalposts, so
// `check` refuses it: land evaluator changes in their own PR, judged against an unchanged app. Budgets
// (harness/budgets.json) are not the evaluator: raising one beside the change that needs it is the intended,
// visible way to accept growth.

const EVALUATOR = /^harness\/bench\/(?:scorer\/|probes\/|suite\.ts$)/u
// What ships. Dependencies count through bun.lock: package.json's scripts never reach the build
const APP =
  /^(?:src\/|public\/|index\.html$|vite\.config\.ts$|bun\.lock$|netlify\/)/u

/** `onBase` says whether a file existed at the base: adding an evaluator file is not editing one */
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
