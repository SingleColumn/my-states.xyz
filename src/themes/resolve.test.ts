import { describe, expect, it } from 'vitest'
import { resolveEffectiveTheme, resolveMode, type ResolveThemeInput } from './resolve'
import { DEFAULT_THEME_ID, mergeLibrary } from './registry'
import type { StoredTheme, ThemeDefinition } from './types'

const custom: ThemeDefinition = { schemaVersion: 1, id: 'custom', name: 'Custom', version: '1.0.0', modes: { light: {}, dark: {} } }
const stored: StoredTheme = { id: 'custom', name: 'Custom', version: '1.0.0', schemaVersion: 1, source: 'imported', definition: custom, createdAt: 0, updatedAt: 0 }
const themes = mergeLibrary([stored])

function resolveWith(overrides: Partial<ResolveThemeInput>) {
  return resolveEffectiveTheme({
    momentThemeId: undefined,
    appearance: { globalThemeId: DEFAULT_THEME_ID, modePreference: 'system' },
    systemPrefersDark: true,
    themes,
    defaultThemeId: DEFAULT_THEME_ID,
    ...overrides,
  })
}

describe('resolveEffectiveTheme', () => {
  it('shows the built-in default when nothing has been chosen', () => {
    expect(resolveWith({})).toMatchObject({ themeId: 'midnight', source: 'global', mode: 'dark' })
  })

  it('shows the global choice for a moment that follows Global', () => {
    expect(resolveWith({ appearance: { globalThemeId: 'terminal', modePreference: 'system' } })).toMatchObject({ themeId: 'terminal', source: 'global' })
  })

  it('lets a moment override the global choice', () => {
    expect(resolveWith({ momentThemeId: 'custom', appearance: { globalThemeId: 'terminal', modePreference: 'system' } })).toMatchObject({ themeId: 'custom', source: 'moment' })
  })

  it('follows a global change when the moment follows Global, and ignores it when the moment overrides', () => {
    const following = (globalThemeId: string) => resolveWith({ appearance: { globalThemeId, modePreference: 'system' } }).themeId
    expect([following('paper'), following('terminal')]).toEqual(['paper', 'terminal'])
    const overriding = (globalThemeId: string) => resolveWith({ momentThemeId: 'custom', appearance: { globalThemeId, modePreference: 'system' } }).themeId
    expect([overriding('paper'), overriding('terminal')]).toEqual(['custom', 'custom'])
  })

  it('falls back to the global theme when the pinned one is missing, and reports the id without clearing it', () => {
    expect(resolveWith({ momentThemeId: 'gone', appearance: { globalThemeId: 'paper', modePreference: 'system' } }))
      .toMatchObject({ themeId: 'paper', source: 'global', missingThemeId: 'gone' })
  })

  it('falls back to the built-in default when the global theme is missing too', () => {
    expect(resolveWith({ momentThemeId: 'gone', appearance: { globalThemeId: 'gone-too', modePreference: 'system' } }))
      .toMatchObject({ themeId: DEFAULT_THEME_ID, source: 'fallback', missingThemeId: 'gone' })
  })

  it('refuses to run without the default theme installed', () => {
    expect(() => resolveWith({ themes: new Map() })).toThrow(/default theme/)
  })
})

describe('resolveMode', () => {
  const dual = custom
  const darkOnly = themes.get('midnight')!
  const lightOnly = themes.get('paper')!

  it('follows the system for a dual-mode theme', () => {
    expect(resolveMode(dual, 'system', true)).toBe('dark')
    expect(resolveMode(dual, 'system', false)).toBe('light')
  })

  it('honours an explicit preference the theme supports', () => {
    expect(resolveMode(dual, 'light', true)).toBe('light')
    expect(resolveMode(dual, 'dark', false)).toBe('dark')
  })

  it('uses the only mode a theme has, whatever was asked for', () => {
    expect(resolveMode(darkOnly, 'light', false)).toBe('dark')
    expect(resolveMode(darkOnly, 'system', false)).toBe('dark')
    expect(resolveMode(lightOnly, 'dark', true)).toBe('light')
  })

  it('re-resolves when the system preference changes at runtime', () => {
    const before = resolveWith({ momentThemeId: 'custom', systemPrefersDark: false }).mode
    const after = resolveWith({ momentThemeId: 'custom', systemPrefersDark: true }).mode
    expect([before, after]).toEqual(['light', 'dark'])
  })
})
