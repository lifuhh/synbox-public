import { Database } from 'bun:sqlite'
import type { SQLQueryBindings } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

// The subset of D1 the Worker calls, over bun:sqlite with every real migration applied in order
export const migratedD1 = () => {
  const sqlite = new Database(':memory:')
  const dir = `${import.meta.dir}/../migrations`
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .toSorted()) {
    sqlite.run(readFileSync(`${dir}/${file}`, 'utf-8'))
  }
  const prepare = (sql: string) => {
    let params: SQLQueryBindings[] = []
    const statement = {
      // oxlint-disable-next-line eslint/require-await -- D1's methods are async; bun:sqlite's are not
      async all() {
        return { results: sqlite.query(sql).all(...params) }
      },
      bind(...values: SQLQueryBindings[]) {
        params = values
        return statement
      },
      // oxlint-disable-next-line eslint/require-await -- as above
      async first(column?: string) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bun:sqlite returns rows untyped
        const row = sqlite.query(sql).get(...params) as Record<
          string,
          unknown
        > | null
        return row !== null && column !== undefined ? row[column] : row
      },
      // oxlint-disable-next-line eslint/require-await -- as above
      async run() {
        const { changes } = sqlite.query(sql).run(...params)
        return { meta: { changes } }
      },
    }
    return statement
  }
  type Statement = ReturnType<typeof prepare>
  const db = {
    // D1 runs a batch as one transaction
    async batch(statements: Statement[]) {
      sqlite.run('begin')
      try {
        const results = []
        for (const statement of statements) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- a transaction runs its statements in order
          results.push(await statement.all())
        }
        sqlite.run('commit')
        return results
      } catch (error) {
        sqlite.run('rollback')
        throw error
      }
    },
    prepare,
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the parts of D1 the Worker calls
  return { db: db as unknown as D1Database, sqlite }
}
