// Which of a module's exports a change can alter at run time, so scope.ts can follow a change only into the files
// that import those exports instead of every file that imports the module. Adding one constant to src/lib/auth.ts
// otherwise reaches everything that imports auth.ts, the player included.
//
// Each top-level statement is a unit: the names it binds and its source text. A name changed when its unit's text
// differs between the two versions, or (transitively) when its unit refers to a changed name. An export changed when
// it now names a different binding or its binding changed. Type-only statements are skipped: they ship nothing.
// Anything else at the top level (a call, `export *`, an import kept for its side effects) runs on import, so a
// change to it, or to a name it refers to, changes the whole module: 'all'.

import { parseSync } from 'vite'

import { isRecord } from './json'

type Node = Record<string, unknown> & { type: string }

const isNode = (v: unknown): v is Node =>
  isRecord(v) && typeof v.type === 'string'

const nameOf = (v: unknown): string | null =>
  isNode(v) && typeof v.name === 'string' ? v.name : null

const nodes = (v: unknown): Node[] =>
  Array.isArray(v) ? v.filter((x): x is Node => isNode(x)) : []

/** Every identifier a subtree mentions: an over-approximation of what it refers to, which only widens the result */
const mentions = (node: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(node)) {
    for (const n of node) {
      mentions(n, out)
    }
    return out
  }
  if (!isNode(node)) {
    return out
  }
  const name = nameOf(node)
  if (
    name !== null &&
    (node.type === 'Identifier' || node.type === 'JSXIdentifier')
  ) {
    out.add(name)
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'type' && typeof value === 'object' && value !== null) {
      mentions(value, out)
    }
  }
  return out
}

/** The names a binding pattern declares (`a`, `{ a, b: [c] }`, `...rest`, `a = 1`) */
const bound = (pattern: unknown): string[] => {
  if (!isNode(pattern)) {
    return []
  }
  switch (pattern.type) {
    case 'Identifier': {
      return [nameOf(pattern) ?? '']
    }
    case 'ObjectPattern': {
      return nodes(pattern.properties).flatMap((p) =>
        bound(p.type === 'RestElement' ? p.argument : p.value)
      )
    }
    case 'ArrayPattern': {
      return nodes(pattern.elements).flatMap(bound)
    }
    case 'RestElement': {
      return bound(pattern.argument)
    }
    case 'AssignmentPattern': {
      return bound(pattern.left)
    }
    default: {
      return []
    }
  }
}

const TYPE_ONLY = new Set([
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSDeclareFunction',
])

const DECLARATIONS = new Set([
  'VariableDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'TSEnumDeclaration',
  ...TYPE_ONLY,
])

interface Unit {
  text: string
  refs: Set<string>
}

interface Module {
  /** Binding name to its unit */
  units: Map<string, Unit>
  /** Statements that run on import */
  effects: Unit[]
  /** Export name to the binding it exports */
  exports: Map<string, string>
}

const DEFAULT = '*default*'

/** Reads one module's top-level statements into units, effects and exports */
class Reader {
  readonly mod: Module = { effects: [], exports: new Map(), units: new Map() }

  private readonly text: string

  constructor(text: string) {
    this.text = text
  }

  private slice(n: Node): string {
    return this.text.slice(Number(n.start), Number(n.end))
  }

  private unit(names: string[], at: Node, refsOf: Node): void {
    const u = { refs: mentions(refsOf), text: this.slice(at) }
    for (const name of names) {
      this.mod.units.set(name, u)
    }
  }

  /** A declaration's bound names, after recording it as a unit; none when it ships nothing */
  private declare(d: Node, at: Node): string[] {
    if (TYPE_ONLY.has(d.type) || d.declare === true) {
      return []
    }
    const names =
      d.type === 'VariableDeclaration'
        ? nodes(d.declarations).flatMap((x) => bound(x.id))
        : [nameOf(d.id) ?? '']
    this.unit(names, at, d)
    return names
  }

  private importDecl(s: Node, specifiers: Node[], source: string): void {
    if (nodes(s.specifiers).length === 0) {
      this.mod.effects.push({ refs: new Set(), text: this.slice(s) })
    }
    for (const x of specifiers) {
      const local = nameOf(x.local) ?? ''
      const imported =
        x.type === 'ImportSpecifier' ? (nameOf(x.imported) ?? local) : x.type
      this.mod.units.set(local, {
        refs: new Set(),
        text: `${source} ${imported}`,
      })
    }
  }

  private exportList(specifiers: Node[], source: string | null): void {
    for (const x of specifiers) {
      const exported = nameOf(x.exported) ?? ''
      const local = nameOf(x.local) ?? ''
      if (source === null) {
        this.mod.exports.set(exported, local)
      } else {
        const key = `${source} ${local}`
        this.mod.units.set(key, { refs: new Set(), text: key })
        this.mod.exports.set(exported, key)
      }
    }
  }

  private exportDefault(s: Node, d: Node): void {
    const id = nameOf(d.id)
    this.unit(id === null ? [DEFAULT] : [id, DEFAULT], s, s)
    this.mod.exports.set('default', id ?? DEFAULT)
  }

  statement(s: Node): void {
    if (s.importKind === 'type' || s.exportKind === 'type') {
      return
    }
    const specifiers = nodes(s.specifiers).filter(
      (x) => x.importKind !== 'type' && x.exportKind !== 'type'
    )
    const source = isNode(s.source) ? String(s.source.value) : null
    if (s.type === 'ImportDeclaration') {
      this.importDecl(s, specifiers, source ?? '')
    } else if (s.type === 'ExportNamedDeclaration' && isNode(s.declaration)) {
      for (const name of this.declare(s.declaration, s)) {
        this.mod.exports.set(name, name)
      }
    } else if (s.type === 'ExportNamedDeclaration') {
      this.exportList(specifiers, source)
    } else if (s.type === 'ExportDefaultDeclaration' && isNode(s.declaration)) {
      this.exportDefault(s, s.declaration)
    } else if (DECLARATIONS.has(s.type)) {
      this.declare(s, s)
    } else {
      // A call, `export *`, a namespace: anything that runs or re-exports on import
      this.mod.effects.push({ refs: mentions(s), text: this.slice(s) })
    }
  }
}

const read = (file: string, text: string): Module => {
  const { program, errors } = parseSync(file, text, {
    lang: file.endsWith('x') ? 'tsx' : 'ts',
  })
  if (errors.length > 0) {
    throw new Error(`can't parse ${file}: ${errors[0]?.message ?? ''}`)
  }
  const reader = new Reader(text)
  for (const s of nodes(program.body)) {
    reader.statement(s)
  }
  return reader.mod
}

/** Bindings whose text changed, then every binding that refers to one, until nothing more changes */
const changedBindings = (old: Module, now: Module): Set<string> => {
  const changed = new Set<string>()
  for (const name of new Set([...old.units.keys(), ...now.units.keys()])) {
    if (old.units.get(name)?.text !== now.units.get(name)?.text) {
      changed.add(name)
    }
  }
  for (let grew = true; grew;) {
    grew = false
    for (const [name, u] of now.units) {
      if (!changed.has(name) && [...u.refs].some((r) => changed.has(r))) {
        changed.add(name)
        grew = true
      }
    }
  }
  return changed
}

/**
 * The exports of `file` whose run-time value the change from `before` to `after` can alter: an empty set when it
 * alters none (types, or comments between statements), 'all' when it changes what the module does on import or
 * can't be read.
 */
export const changedExports = (
  file: string,
  before: string,
  after: string
): Set<string> | 'all' => {
  let old: Module
  let now: Module
  try {
    old = read(file, before)
    now = read(file, after)
  } catch {
    return 'all'
  }
  const changed = changedBindings(old, now)
  const effects = (m: Module) => m.effects.map((e) => e.text).join('\n')
  if (
    effects(old) !== effects(now) ||
    now.effects.some((e) => [...e.refs].some((r) => changed.has(r)))
  ) {
    return 'all'
  }
  const out = new Set<string>()
  for (const name of new Set([...old.exports.keys(), ...now.exports.keys()])) {
    const binding = now.exports.get(name)
    if (
      binding !== old.exports.get(name) ||
      (binding !== undefined && changed.has(binding))
    ) {
      out.add(name)
    }
  }
  return out
}
