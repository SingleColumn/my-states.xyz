import type { StoredTheme, ThemeDefinition, ThemeEntry } from './types'
import { modesOf, validateThemeDefinition, acceptEveryValue } from './validate'
import midnight from './builtin/midnight.theme.json'
import paper from './builtin/paper.theme.json'
import terminal from './builtin/terminal.theme.json'
import kittyBow from './builtin/kitty-bow.theme.json'
import scrapbook from './builtin/scrapbook.theme.json'

/**
 * The built-in themes ship in the bundle and are never written to the
 * database, so an update to one reaches every moment that pins it and there
 * is no stale copy to migrate. The library the app shows is these plus
 * whatever the user imported, merged by `mergeLibrary`.
 *
 * Validated at load with the same validator an import goes through (minus
 * the browser-only CSS value check): a built-in that would fail import is a
 * bug worth failing loudly on at startup.
 */
export const builtInThemes: readonly ThemeDefinition[] = [midnight, paper, terminal, kittyBow, scrapbook].map((definition) => validateThemeDefinition(definition, acceptEveryValue))

/** What a fresh profile shows, and what everything falls back to. Pinned by name, not by position in the list. */
export const DEFAULT_THEME_ID = 'midnight'
if (!builtInThemes.some((theme) => theme.id === DEFAULT_THEME_ID)) throw new Error(`The default theme "${DEFAULT_THEME_ID}" is not among the built-in themes.`)

const builtInIds = new Set(builtInThemes.map((theme) => theme.id))

export function isBuiltInThemeId(id: string): boolean {
  return builtInIds.has(id)
}

export function getBuiltInTheme(id: string): ThemeDefinition | undefined {
  return builtInThemes.find((theme) => theme.id === id)
}

/** Every installed theme by id, built-ins first. A stored id can never shadow a built-in one: storage refuses to write it. */
export function mergeLibrary(stored: readonly StoredTheme[]): Map<string, ThemeDefinition> {
  const library = new Map<string, ThemeDefinition>()
  for (const theme of builtInThemes) library.set(theme.id, theme)
  for (const theme of stored) if (!library.has(theme.id)) library.set(theme.id, theme.definition)
  return library
}

export function toThemeEntry(definition: ThemeDefinition): ThemeEntry {
  return { id: definition.id, name: definition.name, version: definition.version, builtIn: isBuiltInThemeId(definition.id), modes: modesOf(definition) }
}
