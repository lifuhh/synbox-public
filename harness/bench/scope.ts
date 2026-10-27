// Which of `check`'s browser audits a branch can affect. A PR's check runs the static checks, the build and the size
// budgets every time, and only the audits whose pages or probes the branch's diff (against its merge base with
// staging) reaches. The release runs everything (`check --full`).
//
// Pages come from the real import graph, walked statically: each file's imports are read with the bundler's own
// parser (vite › parseSync: static imports, re-exports and `import()` with a literal path; type-only imports are
// skipped, they ship nothing), `@/` resolved as tsconfig and vite.config.ts alias it, and CSS `@import`s followed.
// The entry is index.html's module script. src/app.tsx says which module each route renders; everything the entry
// reaches without going through a route's page module is the shell (globals.css, the root layout, the top bar,
// ui/ components it uses), and a change there affects every page. A change below one page affects that page.
// Anything that can't be placed (a file outside src/ that the build or the bench server reads, a route whose page
// module isn't found) widens the scope; nothing narrows it on a guess.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { parseSync } from 'vite'

import { isRecord } from './json'
import { isDocs } from './reuse'
import type { Repo } from './store'
import type { Benchmark } from './types'

const STAGING = 'origin/staging'

const git = (top: string, ...args: string[]): string =>
  execFileSync('git', ['-C', top, ...args], { encoding: 'utf-8' }).trim()

const lines = (text: string): string[] => text.split('\n').filter(Boolean)

/** Outside src/ and harness/, files that change no page: the auth Worker (replayed), repo chores, editor config */
const NO_PAGE =
  /^(?:worker\/|scripts\/|\.github\/|LICENSE$|\.gitignore$|components\.json$|tsconfig\.node\.json$|dev$|\.env\.example$)/u

/** In harness/bench/, files `check`'s audits never run: the timing bench and tests */
const NOT_AUDITED = /^harness\/bench\/(?:trend\.ts$|scorer\/|.*\.test\.ts$)/u

// ---------------------------------------------------------------------------------------------------------------
// The import graph

const CANDIDATES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '/index.ts',
  '/index.tsx',
]

/** A specifier as a repo-relative file, or null for a package or a virtual module */
const resolve = (top: string, from: string, spec: string): string | null => {
  const bare = spec.replace(/[?#].*$/u, '')
  let base: string
  if (bare.startsWith('@/')) {
    base = path.join(top, 'src', bare.slice(2))
  } else if (bare.startsWith('.')) {
    base = path.resolve(path.dirname(path.join(top, from)), bare)
  } else {
    return null
  }
  const file = CANDIDATES.map((ext) => `${base}${ext}`).find(
    (f) => existsSync(f) && statSync(f).isFile()
  )
  return file === undefined ? null : path.relative(top, file)
}

interface Edge {
  to: string
  dynamic: boolean
}

const literal = (text: string): string | null => {
  const m = /^(?<q>['"`])(?<s>[^'"`$]*)\k<q>$/u.exec(text.trim())
  return m?.groups?.s ?? null
}

/** The modules one file imports at run time */
export const importsOf = (top: string, file: string): Edge[] => {
  const text = readFileSync(path.join(top, file), 'utf-8')
  if (file.endsWith('.css')) {
    return [...text.matchAll(/@import\s+['"](?<s>[^'"]+)['"]/gu)].flatMap(
      (m) => {
        const to = resolve(top, file, m.groups?.s ?? '')
        return to === null ? [] : [{ dynamic: false, to }]
      }
    )
  }
  const lang = file.endsWith('x') ? 'tsx' : 'ts'
  const { module, errors } = parseSync(file, text, { lang })
  if (errors.length > 0 && module.staticImports.length === 0) {
    throw new Error(`can't parse ${file}: ${errors[0]?.message ?? ''}`)
  }
  const specs: Edge[] = []
  const add = (spec: string, dynamic: boolean) => {
    const to = resolve(top, file, spec)
    if (to !== null) {
      specs.push({ dynamic, to })
    }
  }
  for (const imp of module.staticImports) {
    if (imp.entries.length === 0 || imp.entries.some((e) => !e.isType)) {
      add(imp.moduleRequest.value, false)
    }
  }
  for (const exp of module.staticExports) {
    for (const e of exp.entries) {
      if (e.moduleRequest !== null && !e.isType) {
        add(e.moduleRequest.value, false)
      }
    }
  }
  for (const dyn of module.dynamicImports) {
    const spec = literal(
      text.slice(dyn.moduleRequest.start, dyn.moduleRequest.end)
    )
    if (spec !== null) {
      add(spec, true)
    }
  }
  return specs
}

export interface Graph {
  edges: (file: string) => Edge[]
}

export const graphAt = (top: string): Graph => {
  const cache = new Map<string, Edge[]>()
  return {
    edges: (file) => {
      const known = cache.get(file)
      if (known !== undefined) {
        return known
      }
      const found = importsOf(top, file)
      cache.set(file, found)
      return found
    },
  }
}

/** Every module reachable from `roots`, not following an edge `stop` refuses */
export const closure = (
  graph: Graph,
  roots: string[],
  stop: (from: string, to: string) => boolean = () => false
): Set<string> => {
  const seen = new Set<string>(roots)
  const todo = [...roots]
  for (let f = todo.pop(); f !== undefined; f = todo.pop()) {
    for (const { to } of graph.edges(f)) {
      if (!seen.has(to) && !stop(f, to)) {
        seen.add(to)
        todo.push(to)
      }
    }
  }
  return seen
}

// ---------------------------------------------------------------------------------------------------------------
// Routes to page modules, from src/app.tsx's own syntax tree

type Node = Record<string, unknown>

const isNode = (v: unknown): v is Node =>
  isRecord(v) && typeof v.type === 'string'

const walk = (node: unknown, visit: (n: Node) => void): void => {
  if (Array.isArray(node)) {
    for (const n of node) {
      walk(n, visit)
    }
    return
  }
  if (!isNode(node)) {
    return
  }
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'type' && typeof value === 'object' && value !== null) {
      walk(value, visit)
    }
  }
}

const nameOf = (n: unknown): string | null =>
  isNode(n) && typeof n.name === 'string' ? n.name : null

const importsIn = (n: unknown): string[] => {
  const out: string[] = []
  walk(n, (x) => {
    if (x.type === 'ImportExpression' && isNode(x.source)) {
      const v = x.source.value
      if (typeof v === 'string') {
        out.push(v)
      }
    }
  })
  return out
}

export const APP = 'src/app.tsx'

/** A <Route>'s path: its `path` literal, `/` for the index route, null for a pathless layout route */
const routeOf = (pathValue: unknown, index: boolean): string | null => {
  if (isNode(pathValue) && typeof pathValue.value === 'string') {
    return pathValue.value
  }
  return index ? '/' : null
}

/**
 * Each route src/app.tsx declares (the index route as `/`), with the module its element renders: a static import
 * (`import LandingPage from …`), a `lazy(() => import(…))`, or a `lazy(pages.key)` over an object of imports. A
 * route whose element renders none of these (a redirect) maps to null. `layout` is the pathless layout route's
 * module, part of every page.
 */
export const routeModules = (
  top: string
): { routes: Map<string, string | null>; layout: string[] } => {
  const text = readFileSync(path.join(top, APP), 'utf-8')
  const { program, module } = parseSync(APP, text, { lang: 'tsx' })
  const byName = new Map<string, string>()
  for (const imp of module.staticImports) {
    for (const e of imp.entries) {
      if (!e.isType) {
        byName.set(e.localName.value, imp.moduleRequest.value)
      }
    }
  }
  const members = new Map<string, string>()
  walk(program, (n) => {
    const id = nameOf(n.id)
    if (n.type !== 'VariableDeclarator' || id === null) {
      return
    }
    if (isNode(n.init) && n.init.type === 'ObjectExpression') {
      for (const p of Array.isArray(n.init.properties)
        ? n.init.properties
        : []) {
        const key = isNode(p) ? nameOf(p.key) : null
        const found = isNode(p) ? importsIn(p.value) : []
        if (key !== null && found.length === 1 && found[0] !== undefined) {
          members.set(`${id}.${key}`, found[0])
        }
      }
      return
    }
    const found = importsIn(n.init)
    if (found.length === 1 && found[0] !== undefined) {
      byName.set(id, found[0])
      return
    }
    walk(n.init, (m) => {
      const obj = nameOf(m.object)
      const prop = nameOf(m.property)
      const spec =
        m.type === 'MemberExpression' && obj !== null && prop !== null
          ? members.get(`${obj}.${prop}`)
          : undefined
      if (spec !== undefined) {
        byName.set(id, spec)
      }
    })
  })

  const routes = new Map<string, string | null>()
  const layout: string[] = []
  walk(program, (n) => {
    if (n.type !== 'JSXElement' || !isNode(n.openingElement)) {
      return
    }
    const open = n.openingElement
    if (nameOf(open.name) !== 'Route') {
      return
    }
    const attrs = (
      Array.isArray(open.attributes) ? open.attributes : []
    ).filter(isNode)
    const attr = (name: string) => attrs.find((a) => nameOf(a.name) === name)
    const route = routeOf(attr('path')?.value, attr('index') !== undefined)
    // The elements rendered, not their props: a Suspense fallback is shown while the page loads, not the page
    const components: string[] = []
    const rendered = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const x of node) {
          rendered(x)
        }
        return
      }
      if (!isNode(node) || node.type === 'JSXAttribute') {
        return
      }
      const name = node.type === 'JSXOpeningElement' ? nameOf(node.name) : null
      if (name !== null) {
        components.push(name)
      }
      for (const [key, value] of Object.entries(node)) {
        if (key !== 'type' && typeof value === 'object' && value !== null) {
          rendered(value)
        }
      }
    }
    rendered(attr('element')?.value)
    const file =
      components
        .map((c) => byName.get(c))
        .map((s) => (s === undefined ? null : resolve(top, APP, s)))
        .find((f) => f !== null) ?? null
    if (route === null) {
      if (file !== null) {
        layout.push(file)
      }
    } else if (route !== '*') {
      routes.set(route, file)
    }
  })
  return { layout, routes }
}

/** index.html's module scripts, the app's entries */
const entries = (top: string): string[] => {
  const html = readFileSync(path.join(top, 'index.html'), 'utf-8')
  const found = [
    ...html.matchAll(
      /<script\b[^>]*type=["']module["'][^>]*src=["']\/(?<src>[^"']+)["']/gu
    ),
  ].map((m) => m.groups?.src ?? '')
  if (found.length === 0) {
    throw new Error(
      'index.html has no module script to start the import graph from'
    )
  }
  return found
}

export interface PageMap {
  /** Reached from the entry without entering a route's page module: in every page */
  shell: Set<string>
  /** Each route's page module and everything it imports */
  pages: Map<string, Set<string>>
  /** Routes whose page module wasn't found: any change to src/ may affect them */
  unmapped: string[]
}

export const pageMap = (top: string, audited: string[]): PageMap => {
  const graph = graphAt(top)
  const { routes } = routeModules(top)
  const pageFiles = new Set(
    [...routes.values()].filter((f): f is string => f !== null)
  )
  // The router's own imports of page modules (static or lazy) are where a page starts; anything else importing one
  // pulls it into what imports it
  const shell = closure(
    graph,
    entries(top),
    (from, to) => from === APP && pageFiles.has(to)
  )
  const pages = new Map<string, Set<string>>()
  const unmapped: string[] = []
  for (const route of audited) {
    const file = routes.get(route)
    if (file === undefined || file === null) {
      unmapped.push(route)
    } else {
      pages.set(route, closure(graph, [file]))
    }
  }
  return { pages, shell, unmapped }
}

// ---------------------------------------------------------------------------------------------------------------
// The branch's diff to a set of benchmarks

export interface Selection {
  mode: 'full' | 'scoped'
  /** The merge base the diff is taken from */
  base: string | null
  /** What widened the scope, one line each (a shell file, a build file, an evaluator file) */
  why: string[]
  /** Each benchmark that runs, with why */
  run: Map<string, string>
}

/** Files the working tree changes against its merge base with staging: committed, uncommitted and untracked */
export const changedFiles = (repo: Repo): { base: string; files: string[] } => {
  const base = git(repo.top, 'merge-base', 'HEAD', STAGING)
  const files = new Set([
    ...lines(git(repo.top, 'diff', '--name-only', base)),
    ...lines(git(repo.top, 'ls-files', '--others', '--exclude-standard')),
  ])
  return { base, files: [...files].toSorted() }
}

const budgetsAt = (
  top: string,
  ref: string | null
): Record<string, unknown> => {
  const text =
    ref === null
      ? readFileSync(path.join(top, 'harness', 'budgets.json'), 'utf-8')
      : git(top, 'show', `${ref}:harness/budgets.json`)
  const value: unknown = JSON.parse(text)
  return isRecord(value) ? value : {}
}

/** Benchmarks whose lines in harness/budgets.json differ from the base ($-keys are notes) */
const budgetChanges = (top: string, base: string): string[] => {
  const before = budgetsAt(top, base)
  const after = budgetsAt(top, null)
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (id) =>
      !id.startsWith('$') &&
      JSON.stringify(before[id]) !== JSON.stringify(after[id])
  )
}

interface Affects {
  everything: string | null
  routes: Map<string, string[]>
  /** harness files, each with the benchmarks it is part of (empty: none) */
  harness: string[]
  budgets: string[]
  notes: string[]
}

/** A harness file: a budget line, the route list, or part of the bench (placed against probes later) */
const placeHarness = (
  file: string,
  out: Affects,
  top: string,
  base: string
): void => {
  if (file === 'harness/budgets.json') {
    out.budgets = budgetChanges(top, base)
  } else if (file === 'harness/routes.json') {
    out.everything ??= `${file}: the list of routes the audits visit`
  } else if (file.startsWith('harness/bench/') && !NOT_AUDITED.test(file)) {
    out.harness.push(file)
  }
}

/** A file under src/: the shell (every page), the pages that import it, or none */
const placeSource = (file: string, map: PageMap, out: Affects): void => {
  if (map.shell.has(file)) {
    out.everything ??= `${file}: in the app shell, so on every page`
    return
  }
  const routes = [
    ...[...map.pages].filter(([, mods]) => mods.has(file)).map(([r]) => r),
    ...map.unmapped,
  ]
  for (const route of routes) {
    out.routes.set(route, [...(out.routes.get(route) ?? []), file])
  }
  if (routes.length === 0) {
    out.notes.push(`${file}: no audited page imports it`)
  }
}

const affects = (
  repo: Repo,
  base: string,
  files: string[],
  audited: string[]
): Affects => {
  const out: Affects = {
    budgets: [],
    everything: null,
    harness: [],
    notes: [],
    routes: new Map(),
  }
  let map: PageMap | null = null
  for (const file of files) {
    if (isDocs(file) || NO_PAGE.test(file)) {
      continue
    }
    if (file.startsWith('harness/')) {
      placeHarness(file, out, repo.top, base)
    } else if (!file.startsWith('src/')) {
      out.everything ??= `${file}: the build, or what serves it, reads it`
    } else if (existsSync(path.join(repo.top, file))) {
      // A deleted file is skipped: whatever imported it changed too, and is placed on its own
      map ??= pageMap(repo.top, audited)
      placeSource(file, map, out)
    }
  }
  if (map !== null && map.unmapped.length > 0) {
    out.notes.push(
      `page module not found in ${APP} for ${map.unmapped.join(', ')}: any change to src/ runs their audits`
    )
  }
  return out
}

/** Why a benchmark runs for this diff, or null when the diff can't reach it */
const benchWhy = (
  b: Benchmark,
  hit: Affects,
  audited: string[],
  ofProbe: (probe: string) => Set<string>
): string | null => {
  const { scope } = b
  if (scope === 'always') {
    return 'always runs'
  }
  if (scope === undefined) {
    return 'declares no scope, so it always runs'
  }
  if (hit.budgets.includes(b.id)) {
    return 'its budget changed'
  }
  const probeHit = hit.harness.find((f) => ofProbe(scope.probe).has(f))
  if (probeHit !== undefined) {
    return `its probe changed: ${probeHit}`
  }
  const unknown = scope.routes.filter((r) => !audited.includes(r))
  if (unknown.length > 0) {
    return `visits ${unknown.join(', ')}, not an audited route, so it always runs`
  }
  for (const route of scope.routes) {
    const [first, ...more] = hit.routes.get(route) ?? []
    if (first !== undefined) {
      return `${route}: ${first}${more.length > 0 ? ` (+${more.length} more)` : ''}`
    }
  }
  return null
}

/**
 * Which benchmarks a check runs, and why each. `--full` (and the release) runs all of them. Anything this can't
 * work out runs everything, saying why.
 */
export const selectBenches = (
  repo: Repo,
  benches: Benchmark[],
  opts: {
    full: boolean
    audited: string[]
    /** The diff, when the caller has it (tests); else the working tree against its merge base with staging */
    changed?: { base: string; files: string[] }
  }
): Selection => {
  const all = (
    why: string[],
    base: string | null,
    mode: Selection['mode'] = 'scoped'
  ): Selection => ({
    base,
    mode,
    run: new Map(benches.map((b) => [b.id, 'everything runs'])),
    why,
  })
  if (opts.full) {
    return all(['--full: every audit'], null, 'full')
  }
  let base: string | null = null
  try {
    const changed = opts.changed ?? changedFiles(repo)
    ;({ base } = changed)
    // A clean tree on staging itself (or behind it) has no branch to scope: a check there judges staging, as an
    // older release script does with a plain `check`
    if (base === repo.sha && !repo.dirty) {
      return all(
        ['HEAD is on staging, not a branch off it: every audit'],
        null,
        'full'
      )
    }
    const hit = affects(repo, changed.base, changed.files, opts.audited)
    if (hit.everything !== null) {
      return all([hit.everything, ...hit.notes], base)
    }
    const graph = graphAt(repo.top)
    const probeFiles = new Map<string, Set<string>>()
    const ofProbe = (probe: string): Set<string> => {
      const known = probeFiles.get(probe)
      if (known !== undefined) {
        return known
      }
      if (!existsSync(path.join(repo.top, probe))) {
        throw new Error(`a benchmark's probe ${probe} doesn't exist`)
      }
      const found = closure(graph, [probe])
      probeFiles.set(probe, found)
      return found
    }
    const probes = [
      ...new Set(
        benches.flatMap((b) =>
          b.scope === undefined || b.scope === 'always' ? [] : [b.scope.probe]
        )
      ),
    ]
    // A bench file in no probe is the check itself (suite, server, build, check, this file): everything runs
    for (const file of hit.harness) {
      if (!probes.some((p) => ofProbe(p).has(file))) {
        return all(
          [`${file}: part of the check itself, not one probe`, ...hit.notes],
          base
        )
      }
    }
    const run = new Map<string, string>()
    for (const b of benches) {
      const why = benchWhy(b, hit, opts.audited, ofProbe)
      if (why !== null) {
        run.set(b.id, why)
      }
    }
    return { base, mode: 'scoped', run, why: hit.notes }
  } catch (error) {
    return all(
      [
        `scope not worked out (${error instanceof Error ? error.message : String(error)}): every audit`,
      ],
      base
    )
  }
}
