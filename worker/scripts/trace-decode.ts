/// <reference types="bun" />
// Who a copied translation came from. Reads the text on stdin, prints each invisible mark it carries (src/lyrics.ts ›
// traceMark) and, given the requesters that read lyrics in the last 30 days (one per line: `u:<userId>` or a guest
// network `g:<hash>`, exported from the lyrics_hit table) and TRACE_KEY in the environment, the ones that match.
//   bun scripts/trace-decode.ts [requesters.txt] < copied.txt
import { readFileSync } from 'node:fs'

import { readMarks, traceTag } from '../src/lyrics'

const text = await Bun.stdin.text()
const tags = [...new Set(readMarks(text))]
if (tags.length === 0) {
  console.log('no mark found')
  process.exit(1)
}
console.log(`marks: ${tags.join(', ')}`)

const [listPath] = process.argv.slice(2)
const secret = process.env.TRACE_KEY ?? ''
if (listPath === undefined || secret === '') {
  console.log(
    'to name the requester: pass the requesters file and set TRACE_KEY'
  )
  process.exit(0)
}
const requesters = readFileSync(listPath, 'utf-8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '')
for (const requester of requesters) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- a few hundred HMACs, one at a time
  if (tags.includes(await traceTag(secret, requester))) {
    console.log(`match: ${requester}`)
  }
}
