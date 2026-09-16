import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileThemeAttributes, compileThemeMode } from './compile'
import { builtInThemes, getBuiltInTheme } from './registry'
import { THEME_TOKEN_NAMES } from './tokens'

/**
 * The custom properties theme.css declares on :root, whitespace-normalised.
 * Comments are stripped first; a value may span lines.
 */
function readThemeCssRoot(): Map<string, string> {
  const css = readFileSync(resolve(__dirname, '..', 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)
  if (!root) throw new Error('theme.css has no :root block')
  const tokens = new Map<string, string>()
  for (const match of root[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([\s\S]*?);/g)) {
    tokens.set(match[1], match[2].replace(/\s+/g, ' ').trim())
  }
  return tokens
}

describe('the built-in Midnight theme and theme.css', () => {
  const css = readThemeCssRoot()
  const compiled = compileThemeMode(getBuiltInTheme('midnight')!.modes.dark!)

  it('compile to the same values, token for token', () => {
    const differences: string[] = []
    for (const [name, value] of css) {
      if (value.includes('var(') || value === 'initial') continue // an alias of another token, or a deliberate fallthrough, not a theme value
      if (compiled[name] !== value) differences.push(`${name}: css=${JSON.stringify(value)} midnight=${JSON.stringify(compiled[name])}`)
    }
    expect(differences).toEqual([])
  })

  it('leave no compiled token without a stylesheet fallback', () => {
    for (const name of Object.keys(compiled)) expect(css.has(name), name).toBe(true)
  })

  it('declare every themeable token in the stylesheet, so a partial theme falls back to a real value', () => {
    for (const name of THEME_TOKEN_NAMES) expect(css.has(name), name).toBe(true)
  })
})

describe('compileThemeMode', () => {
  it('emits nothing for an empty mode, leaving the stylesheet in charge', () => {
    expect(compileThemeMode({})).toEqual({})
  })

  it('derives the semantic and component layers from a few foundation colours', () => {
    const tokens = compileThemeMode({ foundation: { color: { background: '#fff', foreground: '#000', accent: 'red' } } })
    expect(tokens['--color-canvas']).toBe('#fff')
    expect(tokens['--text-primary']).toBe('#000')
    expect(tokens['--color-text-muted']).toBe('color-mix(in srgb, #000 64%, transparent)')
    expect(tokens['--color-panel-border']).toBe('color-mix(in srgb, #000 16%, transparent)')
    expect(tokens['--color-attention-glow']).toBe('red')
    expect(tokens['--accent-spotify']).toBe('red')
    expect(tokens['--bg-notes']).toBe('#fff')
    // Nothing given, nothing derivable: the shadow stays the stylesheet's.
    expect(tokens['--shadow-panel']).toBeUndefined()
  })

  it('lets each layer override the one below it', () => {
    const tokens = compileThemeMode({
      foundation: { color: { foreground: '#000' } },
      semantic: { textMuted: '#333' },
      components: { button: { foreground: '#666' }, images: { accent: 'orange' } },
    })
    expect(tokens['--color-text-muted']).toBe('#333')
    expect(tokens['--card-button-icon-color']).toBe('#666')
    expect(tokens['--card-button-active-icon']).toBe('color-mix(in srgb, #000 80%, transparent)')
    expect(tokens['--accent-slideshow']).toBe('orange')
  })

  it('points a named choice at the asset the stylesheet ships', () => {
    const tokens = compileThemeMode({ components: { panel: { texture: 'paper' }, images: { edge: 'deckle' } } })
    expect(tokens['--panel-texture']).toBe('var(--texture-paper)')
    expect(tokens['--image-edge-mask']).toBe('var(--image-edge-deckle)')
    expect(compileThemeMode({})['--panel-texture']).toBeUndefined()
  })

  it('reports a style choice as a root attribute, not a token, and only when the theme names it', () => {
    expect(compileThemeAttributes({ components: { panel: { headerStyle: 'band' } } })).toEqual({ 'header-style': 'band' })
    expect(compileThemeAttributes({})).toEqual({})
    expect(compileThemeMode({ components: { panel: { headerStyle: 'band' } } })).not.toHaveProperty('--card-header-band-style')
    // The band's colours are ordinary derived tokens.
    expect(compileThemeMode({ foundation: { color: { background: '#fff', accent: 'red' } } })).toMatchObject({ '--card-header-band-foreground': '#fff' })
    // The band and rule colours have no derivation: absent, the stylesheet falls through to each panel's own accent.
    expect(compileThemeMode({ foundation: { color: { accent: 'red' } } })).not.toHaveProperty('--card-header-band')
  })

  it('turns the grid colour into the two gradients the stylesheet draws', () => {
    const tokens = compileThemeMode({ components: { canvas: { gridColor: 'rgba(0, 0, 0, 0.1)' } } })
    expect(tokens['--background-canvas-grid']).toBe('linear-gradient(rgba(0, 0, 0, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 0, 0, 0.1) 1px, transparent 1px)')
  })

  it('compiles every built-in theme without error and sets the canvas colour', () => {
    for (const theme of builtInThemes) {
      for (const mode of Object.values(theme.modes)) {
        expect(compileThemeMode(mode)['--color-canvas'], theme.id).toBeTruthy()
      }
    }
  })
})
