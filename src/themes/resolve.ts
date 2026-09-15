import type { AppearanceSettings, EffectiveTheme, ThemeDefinition, ThemeModeName } from './types'
import { modesOf } from './validate'

export interface ResolveThemeInput {
  /** The open moment's pinned theme, if it has one. */
  momentThemeId: string | null | undefined
  appearance: AppearanceSettings
  /** True when the operating system prefers dark. */
  systemPrefersDark: boolean
  /** Every installed theme by id: built-ins and stored ones together. */
  themes: ReadonlyMap<string, ThemeDefinition>
  defaultThemeId: string
}

/**
 * Which theme is on screen, decided in one place. A moment's own choice
 * wins while that theme is installed; then the app setting; then the
 * built-in default, which is always installed. A pinned theme that is not
 * installed is reported, not cleared: it may be imported later.
 */
export function resolveEffectiveTheme(input: ResolveThemeInput): EffectiveTheme {
  const { momentThemeId, appearance, themes, defaultThemeId } = input
  const fallback = themes.get(defaultThemeId)
  if (!fallback) throw new Error(`The default theme "${defaultThemeId}" is not installed.`)

  const pinned = momentThemeId ? themes.get(momentThemeId) : undefined
  const global = themes.get(appearance.globalThemeId)
  const missingThemeId = momentThemeId && !pinned ? momentThemeId : undefined

  const chosen = pinned
    ? { themeId: momentThemeId!, source: 'moment' as const, definition: pinned }
    : global
      ? { themeId: appearance.globalThemeId, source: 'global' as const, definition: global }
      : { themeId: defaultThemeId, source: 'fallback' as const, definition: fallback }

  return {
    ...chosen,
    mode: resolveMode(chosen.definition, appearance.modePreference, input.systemPrefersDark),
    ...(missingThemeId ? { missingThemeId } : {}),
  }
}

/**
 * The mode a theme is shown in: the one asked for when the theme has it,
 * otherwise the one it has. With no usable system preference and both
 * modes available, light.
 */
export function resolveMode(definition: ThemeDefinition, preference: AppearanceSettings['modePreference'], systemPrefersDark: boolean): ThemeModeName {
  const available = modesOf(definition)
  const wanted: ThemeModeName = preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference
  if (available.includes(wanted)) return wanted
  return available[0] ?? 'dark'
}
