import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { buildThemeJsonSchema } from './schema'
import { builtInThemes } from './registry'
import { listLeaves, themeModeSpec } from './tokens'
import { acceptEveryValue, validateThemeDefinition } from './validate'

const schemaPath = resolve(__dirname, 'theme.schema.json')

/**
 * theme.schema.json is the contract handed to theme authors and agents. It
 * is generated from the same spec the importer walks, and committed so it
 * can be read without running anything. When the spec changes, regenerate
 * with:
 *
 *   UPDATE_THEME_SCHEMA=1 npx vitest run src/themes/schema.test.ts
 */
describe('theme.schema.json', () => {
  const generated = buildThemeJsonSchema()

  it('is the committed file (regenerate with UPDATE_THEME_SCHEMA=1 when the token spec changes)', () => {
    if (process.env.UPDATE_THEME_SCHEMA) writeFileSync(schemaPath, `${JSON.stringify(generated, null, 2)}\n`)
    expect(JSON.parse(readFileSync(schemaPath, 'utf8'))).toEqual(generated)
  })

  it('is a valid JSON Schema that accepts every built-in theme', () => {
    const validate = new Ajv({ allErrors: true }).compile(generated)
    for (const theme of builtInThemes) {
      expect(validate(theme), JSON.stringify(validate.errors)).toBe(true)
    }
  })

  it('names every token path the compiler knows and nothing else', () => {
    const paths = new Set<string>()
    const walk = (node: Record<string, unknown>, prefix: string) => {
      for (const [key, child] of Object.entries(node.properties as Record<string, Record<string, unknown>>)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (child.type === 'object') walk(child, path)
        else paths.add(path)
      }
    }
    walk(((generated.properties as Record<string, Record<string, unknown>>).modes.properties as Record<string, Record<string, unknown>>).dark, '')
    expect([...paths].sort()).toEqual(listLeaves(themeModeSpec).map((leaf) => leaf.path).sort())
  })

  it('agrees with the importer on a set of edge cases', () => {
    const validate = new Ajv({ allErrors: true }).compile(generated)
    const base = { schemaVersion: 1, id: 'x', name: 'X', version: '1.0.0', modes: { dark: {} } }
    const cases: unknown[] = [
      base,
      { ...base, modes: {} },
      { ...base, modes: { dusk: {} } },
      { ...base, id: 'Bad Id' },
      { ...base, version: 'one' },
      { ...base, schemaVersion: 2 },
      { ...base, extra: true },
      { ...base, modes: { dark: { components: { foo: {} } } } },
      { ...base, modes: { dark: { foundation: { color: { background: '' } } } } },
      { ...base, modes: { dark: { foundation: { color: { background: 1 } } } } },
      { ...base, modes: { light: { semantic: { textPrimary: '#000' } } } },
    ]
    for (const candidate of cases) {
      let importerAccepts = true
      try {
        validateThemeDefinition(candidate, acceptEveryValue)
      } catch {
        importerAccepts = false
      }
      expect(validate(candidate), JSON.stringify(candidate)).toBe(importerAccepts)
    }
  })
})
