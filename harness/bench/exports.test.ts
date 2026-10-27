import { describe, expect, test } from 'vite-plus/test'

import { changedExports } from './exports'

const BASE = `import { cap } from './limits'
import './side.css'

const LABEL = 'Songs'
const helper = (n: number) => n * cap
export interface Shape { n: number }
export const left = (n: number) => \`\${helper(n)} \${LABEL}\`
export const right = () => cap
export default function Page() { return <Card label={LABEL} /> }
`

const diff = (after: string) => changedExports('x.tsx', BASE, after)

describe('changedExports', () => {
  test('a new export changes only itself', () => {
    expect(diff(`${BASE}export const SONGS_A_DAY = 3\n`)).toEqual(
      new Set(['SONGS_A_DAY'])
    )
  })

  test('a helper change reaches the exports that use it, through other helpers too', () => {
    expect(diff(BASE.replace('n * cap', 'n * cap + 1'))).toEqual(
      new Set(['left'])
    )
    expect(diff(BASE.replace("'Songs'", "'Tracks'"))).toEqual(
      new Set(['left', 'default'])
    )
  })

  test('an import now from elsewhere changes what reads it', () => {
    expect(diff(BASE.replace("'./limits'", "'./quota'"))).toEqual(
      new Set(['left', 'right'])
    )
  })

  test('a type-only change alters no export', () => {
    expect(diff(BASE.replace('n: number }', 'n: number; m: string }'))).toEqual(
      new Set()
    )
  })

  test('code that runs on import changes the whole module', () => {
    expect(diff(`${BASE}register(left)\n`)).toBe('all')
    expect(diff(BASE.replace("import './side.css'\n", ''))).toBe('all')
  })

  test('a change to a name that import-time code reads changes the whole module', () => {
    const withCall = `${BASE}register(LABEL)\n`
    expect(
      changedExports('x.tsx', withCall, withCall.replace("'Songs'", "'Tracks'"))
    ).toBe('all')
  })

  test('a module that does not parse counts whole', () => {
    expect(diff(`${BASE}export const = \n`)).toBe('all')
  })
})
