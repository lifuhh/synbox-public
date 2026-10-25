// The app uses ES2023's copying array methods (toSorted, toReversed, toSpliced, with) and findLast/findLastIndex.
// Browsers before Chrome 110 and Safari 16 lack them, and Home's chart threw there (Sentry, 2026-10-26). Filled in
// before anything else runs, only where missing; each copies, as the real one does
type Method = (this: unknown[], ...args: never[]) => unknown

const define = (name: string, method: Method) => {
  if (!(name in Array.prototype)) {
    // oxlint-disable-next-line no-extend-native -- a polyfill: adds the standard method only where the engine lacks it
    Object.defineProperty(Array.prototype, name, {
      configurable: true,
      value: method,
      writable: true,
    })
  }
}

const toSorted = function toSorted(
  this: unknown[],
  compare?: (a: unknown, b: unknown) => number
) {
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy, which is what toSorted means
  return [...this].sort(compare)
}

const toReversed = function toReversed(this: unknown[]) {
  // oxlint-disable-next-line unicorn/no-array-reverse -- reverses a fresh copy, which is what toReversed means
  return [...this].reverse()
}

const toSpliced = function toSpliced(
  this: unknown[],
  start: number,
  deleteCount?: number,
  ...items: unknown[]
) {
  const copy = [...this]
  copy.splice(start, deleteCount ?? copy.length - start, ...items)
  return copy
}

const withAt = function withAt(this: unknown[], index: number, value: unknown) {
  const copy = [...this]
  copy[index < 0 ? copy.length + index : index] = value
  return copy
}

const findLastIndex = function findLastIndex(
  this: unknown[],
  test: (value: unknown, index: number) => boolean
) {
  for (let index = this.length - 1; index >= 0; index -= 1) {
    if (test(this[index], index)) {
      return index
    }
  }
  return -1
}

const findLast = function findLast(
  this: unknown[],
  test: (value: unknown, index: number) => boolean
) {
  // -1 when nothing matches, and this[-1] is undefined, as the real findLast returns
  return this[findLastIndex.call(this, test)]
}

define('toSorted', toSorted)
define('toReversed', toReversed)
define('toSpliced', toSpliced)
define('with', withAt)
define('findLastIndex', findLastIndex)
define('findLast', findLast)
