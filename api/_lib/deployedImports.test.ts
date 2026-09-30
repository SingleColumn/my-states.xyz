/// <reference types="vite/client" />
// A deployed function is loaded as a plain ES module, because package.json says
// "type": "module". Node's ES module loader does no guessing: a relative import
// must spell out its extension, and must point at a file that was packaged with
// the function. Vitest and the browser bundler guess happily, so every other
// test passes while the deployed function dies on its first request with
//
//   ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/api/_lib/httpAdapter'
//
// which is exactly what happened on the first preview deployment. This reads the
// source of every file that gets deployed and holds it to those two rules.
import { describe, expect, it } from 'vitest'

/** What is wrong with the relative imports in one deployed file. Empty means nothing. */
export function importProblems(location: string, source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  const specifiers: string[] = []
  const pattern = /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of withoutComments.matchAll(pattern)) specifiers.push(match[1] ?? match[2] ?? match[3])

  const problems: string[] = []
  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) continue
    if (!/\.(js|mjs|cjs|json)$/.test(specifier)) {
      problems.push(`${location}: '${specifier}' has no file extension, which Node's ES module loader will not add`)
    }
    if (!new URL(specifier, `http://host${location}`).pathname.startsWith('/api/')) {
      problems.push(`${location}: '${specifier}' reaches outside api/, so it is not packaged with the function`)
    }
  }
  return problems
}

// Every source file under api/, as text. Keys are relative to this file.
const sources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/**
 * Files that become part of a deployment: not the tests, not the type
 * declarations. Each key is relative to this file (`./x.ts` for a neighbour,
 * `../spotify/x.ts` for a file in a sibling folder), so it is resolved from
 * where this file lives to get the path the file will have once deployed.
 */
const thisFile = 'http://host/api/_lib/deployedImports.test.ts'
const deployed = Object.entries(sources)
  .filter(([key]) => !key.endsWith('.test.ts') && !key.endsWith('.d.ts'))
  .map(([key, source]) => ({ location: new URL(key, thisFile).pathname, source }))

describe('The files that are deployed as the Spotify functions', () => {
  // Without this, a glob that quietly matched nothing would pass every check below.
  it('are the ones this test thinks it is checking', () => {
    const names = deployed.map((file) => file.location).sort()
    expect(names).toEqual([
      '/api/_lib/httpAdapter.ts',
      '/api/_lib/spotifyAppToken.ts',
      '/api/_lib/spotifyCatalog.ts',
      '/api/_lib/spotifyCatalogTypes.ts',
      '/api/spotify/playlists.ts',
      '/api/spotify/search.ts',
    ])
    expect(deployed.some((file) => /from\s*['"]\./.test(file.source))).toBe(true)
  })

  it('import each other with explicit extensions, and only from within api/', () => {
    const problems = deployed.flatMap((file) => importProblems(file.location, file.source))
    expect(problems).toEqual([])
  })
})

// The check has to be able to fail, or a pass means nothing.
describe('The import check itself', () => {
  it('flags a relative import with no extension', () => {
    expect(importProblems('/api/spotify/search.ts', `import { x } from '../_lib/httpAdapter'`)).toHaveLength(1)
  })

  it('flags an import that leaves api/, even with an extension', () => {
    expect(importProblems('/api/_lib/spotifyCatalog.ts', `import { x } from '../../src/spotifyCatalogTypes.js'`)).toHaveLength(1)
  })

  it('flags both faults at once', () => {
    expect(importProblems('/api/_lib/spotifyCatalog.ts', `import { x } from '../../src/spotifyCatalogTypes'`)).toHaveLength(2)
  })

  it('accepts an explicit extension inside api/', () => {
    expect(importProblems('/api/spotify/search.ts', `import { x } from '../_lib/httpAdapter.js'`)).toEqual([])
    expect(importProblems('/api/_lib/httpAdapter.ts', `import type { A } from './spotifyCatalog.js'`)).toEqual([])
  })

  it('reads multi-line imports, re-exports and dynamic imports', () => {
    expect(importProblems('/api/_lib/a.ts', `import {\n  one,\n  two,\n} from './b'`)).toHaveLength(1)
    expect(importProblems('/api/_lib/a.ts', `export { one } from './b'`)).toHaveLength(1)
    expect(importProblems('/api/_lib/a.ts', `const m = await import('./b')`)).toHaveLength(1)
  })

  it('ignores packages, and text inside comments', () => {
    expect(importProblems('/api/_lib/a.ts', `import { z } from 'some-package'`)).toEqual([])
    expect(importProblems('/api/_lib/a.ts', `// import x from './b'\n/* import y from '../c' */`)).toEqual([])
  })
})
