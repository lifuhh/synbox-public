import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vite-plus/test'

import { SECURITY_HEADERS, withSecurityHeaders } from './security-headers'

// netlify.toml's [[headers]] block for "/*", as Netlify reads it: a multi-line string's line-ending backslash
// drops the newline and the next line's leading spaces
const tomlHeaders = () => {
  const toml = readFileSync(
    new URL('../netlify.toml', import.meta.url),
    'utf-8'
  )
  const marker = 'for = "/*"\n[headers.values]\n'
  const start = toml.indexOf(marker) + marker.length
  if (start === marker.length - 1) {
    throw new Error('netlify.toml has no [[headers]] for "/*"')
  }
  const end = toml.indexOf('[[', start)
  const block = toml.slice(start, end === -1 ? undefined : end)
  const values: Record<string, string> = {}
  for (const match of block.matchAll(
    /^(?<name>[\w-]+) = (?:"""(?<long>[\s\S]*?)"""|"(?<short>[^"\n]*)")/gmu
  )) {
    const { name, long, short } = match.groups ?? {}
    if (name !== undefined) {
      values[name] = long?.replaceAll(/\\\n\s*/gu, '') ?? short ?? ''
    }
  }
  return values
}

describe('security headers', () => {
  it('netlify.toml and the Edge Function send the same headers', () => {
    expect(tomlHeaders()).toEqual(SECURITY_HEADERS)
  })

  it('an Edge Function response keeps its own headers and gains these', async () => {
    const page = new Response('<html></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      status: 200,
    })
    const answer = withSecurityHeaders(page)
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(answer.headers.get('x-frame-options')).toBe('DENY')
    expect(answer.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'"
    )
    expect(await answer.text()).toBe('<html></html>')
  })
})
