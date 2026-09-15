import { describe, expect, it } from 'vitest'
import { acceptEveryValue, isSafeCssValue, parseThemeFile, ThemeValidationError, validateThemeDefinition, type SupportsCssValue } from './validate'

const minimal = { schemaVersion: 1, id: 'plain', name: 'Plain', version: '1.0.0', modes: { dark: {} } }

function problemsOf(value: unknown, supports: SupportsCssValue = acceptEveryValue): string[] {
  try {
    validateThemeDefinition(value, supports)
    return []
  } catch (error) {
    if (error instanceof ThemeValidationError) return [...error.problems]
    throw error
  }
}

describe('validateThemeDefinition', () => {
  it('accepts a minimal theme, a light-only, a dark-only and a dual-mode theme', () => {
    expect(problemsOf(minimal)).toEqual([])
    expect(problemsOf({ ...minimal, modes: { light: {} } })).toEqual([])
    expect(problemsOf({ ...minimal, modes: { light: {}, dark: {} } })).toEqual([])
  })

  it('returns the object it was given, unchanged', () => {
    const value = { ...minimal, modes: { dark: { foundation: { color: { background: '#000' } } } } }
    expect(validateThemeDefinition(value, acceptEveryValue)).toBe(value)
  })

  it('reports missing or malformed metadata, all at once, by name', () => {
    const problems = problemsOf({ schemaVersion: 1, id: 'Not Ok', name: '', version: 'v1', modes: { dark: {} } })
    expect(problems).toEqual([
      expect.stringContaining('id must be'),
      expect.stringContaining('name must be'),
      expect.stringContaining('version must be'),
    ])
  })

  it('tells a newer schema version apart from a wrong one', () => {
    expect(problemsOf({ ...minimal, schemaVersion: 2 })[0]).toMatch(/needs a newer version of my-states/)
    expect(problemsOf({ ...minimal, schemaVersion: 'one' })[0]).toMatch(/schemaVersion must be 1/)
  })

  it('requires at least one supported mode and no other', () => {
    expect(problemsOf({ ...minimal, modes: {} })).toEqual([expect.stringContaining('at least one of light or dark')])
    expect(problemsOf({ ...minimal, modes: { dusk: {} } })).toEqual([
      expect.stringContaining('modes.dusk is not a supported mode'),
      expect.stringContaining('at least one of light or dark'),
    ])
    expect(problemsOf({ ...minimal, modes: [] })).toEqual([expect.stringContaining('modes must be an object')])
  })

  it('rejects unknown properties at every level, by path', () => {
    expect(problemsOf({ ...minimal, theme: 'x' })).toEqual(['theme is not a supported property'])
    expect(problemsOf({ ...minimal, modes: { dark: { layout: {} } } })).toEqual(['modes.dark.layout is not a supported property'])
    expect(problemsOf({ ...minimal, modes: { dark: { components: { foo: { bar: '#000' } } } } })).toEqual(['modes.dark.components.foo is not a supported property'])
    expect(problemsOf({ ...minimal, modes: { dark: { components: { canvas: { width: '10px' } } } } })).toEqual(['modes.dark.components.canvas.width is not a supported property'])
  })

  it('rejects values of the wrong type or length', () => {
    expect(problemsOf({ ...minimal, modes: { dark: { foundation: { color: { background: 1 } } } } })).toEqual(['modes.dark.foundation.color.background must be a non-empty string'])
    expect(problemsOf({ ...minimal, modes: { dark: { foundation: { color: { background: '   ' } } } } })).toEqual(['modes.dark.foundation.color.background must be a non-empty string'])
    expect(problemsOf({ ...minimal, modes: { dark: { foundation: { color: { background: '#'.repeat(600) } } } } })).toEqual([expect.stringContaining('at most 512 characters')])
    expect(problemsOf({ ...minimal, modes: { dark: { foundation: '#000' } } })).toEqual(['modes.dark.foundation must be an object'])
  })

  it('rejects values that would reach outside the page or into internal names', () => {
    for (const value of ['url(https://x)', 'image-set("a.png")', 'var(--color-text)', 'attr(data-x)', 'red; color: blue', 'red } body { x', '<b>']) {
      expect(isSafeCssValue(value), value).toBe(false)
    }
    for (const value of ['#fff', 'rgba(0, 0, 0, 0.5)', 'color-mix(in srgb, red 20%, transparent)', 'linear-gradient(135deg, #000, #fff)', 'blur(18px)', '0 2px 4px rgb(0 0 0 / 30%)', '"Segoe UI", sans-serif']) {
      expect(isSafeCssValue(value), value).toBe(true)
    }
    expect(problemsOf({ ...minimal, modes: { dark: { components: { canvas: { backdrop: 'url(x.png)' } } } } })).toEqual([expect.stringContaining('must not contain url()')])
  })

  it('accepts only the named choices for a texture or an edge, and never runs CSS.supports on them', () => {
    const supports: SupportsCssValue = () => { throw new Error('a choice is not a CSS value') }
    expect(problemsOf({ ...minimal, modes: { dark: { components: { panel: { texture: 'paper' }, images: { edge: 'deckle' } } } } }, supports)).toEqual([])
    expect(problemsOf({ ...minimal, modes: { dark: { components: { panel: { texture: 'linen' } } } } }, supports)).toEqual(['modes.dark.components.panel.texture must be one of: none, paper, dots'])
  })

  it('checks each value for the kind of CSS it must be, through the injected CSS.supports', () => {
    const supports: SupportsCssValue = (property, value) => !(property === 'color' && value === 'notacolour')
    expect(problemsOf({ ...minimal, modes: { dark: { foundation: { color: { background: 'notacolour' } } } } }, supports))
      .toEqual(['modes.dark.foundation.color.background is not a valid color value: "notacolour"'])
    expect(problemsOf({ ...minimal, modes: { dark: { foundation: { depth: { shadowLarge: 'notacolour' } } } } }, supports)).toEqual([])
  })
})

describe('parseThemeFile', () => {
  it('rejects a file that is not JSON, or too large, before looking inside', () => {
    expect(() => parseThemeFile('{oops', acceptEveryValue)).toThrow(/not valid JSON/)
    expect(() => parseThemeFile(`{"pad":"${'x'.repeat(70 * 1024)}"}`, acceptEveryValue)).toThrow(/larger than 64 KB/)
  })

  it('formats every problem as one actionable message', () => {
    expect(() => parseThemeFile(JSON.stringify({ ...minimal, id: 'X', modes: { dark: { components: { foo: {} } } } }), acceptEveryValue))
      .toThrow('Theme could not be imported:\n- id must be lower-case letters, digits and hyphens, starting with a letter or digit (at most 64 characters)\n- modes.dark.components.foo is not a supported property')
  })
})
