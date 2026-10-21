// The evaluator is read-only to the work it judges. A branch that changes how scores are computed (the scorer)
// and the app in one go could pass by moving the goalposts, so the gate refuses it: land scorer changes in their
// own PR, measured against an unchanged app.

const EVALUATOR_DIR = 'harness/bench/scorer/'
const APP =
  /^(?:src\/|public\/|index\.html$|vite\.config\.ts$|package\.json$|netlify\/)/u

/** `onBase` says whether a file existed at the merge base: adding the scorer (the harness's own first PR) is not editing it */
export const evaluatorTouched = (
  changed: string[],
  onBase: (file: string) => boolean
): string | null => {
  const scorer = changed.filter((f) => f.startsWith(EVALUATOR_DIR) && onBase(f))
  const app = changed.filter((f) => APP.test(f))
  return scorer.length > 0 && app.length > 0
    ? `this branch changes the scorer (${scorer.join(', ')}) and the app (${app.length} files) together; split the scorer change into its own PR`
    : null
}
