// JSON the bench reads back (its history, verdicts, fixtures, other tools' reports) is checked for the fields it
// relies on, so a file from another version fails where it is read instead of deep in the scorer.

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const parseJson = <T>(
  text: string,
  is: (v: unknown) => v is T,
  what: string
): T => {
  const value: unknown = JSON.parse(text)
  if (!is(value)) {
    throw new Error(`${what} is not in the expected shape`)
  }
  return value
}
