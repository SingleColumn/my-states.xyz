import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Moment } from './types'
import {
  deleteStoredTheme,
  getAppearanceSettings,
  importStoredTheme,
  listStoredThemes,
  setGlobalThemeId,
  setThemeModePreference,
  type ThemeImportOutcome,
} from './storage'
import { applyTheme } from './theme'
import { DEFAULT_THEME_ID, mergeLibrary, toThemeEntry } from './themes/registry'
import { resolveEffectiveTheme } from './themes/resolve'
import type { AppearanceSettings, EffectiveTheme, StoredTheme, ThemeEntry, ThemeModePreference } from './themes/types'
import { parseThemeFile, type SupportsCssValue } from './themes/validate'

/**
 * Appearance: the theme library, the app-level settings, and the one
 * resolved theme on screen. Everything the Settings dialog, the moment
 * toolbar and the canvas need to agree on comes from here, and the theme is
 * applied to the page from here, so no component decides precedence for
 * itself.
 */
export interface AppearanceState {
  isReady: boolean
  /** Every installed theme, built-ins first. */
  themes: ThemeEntry[]
  settings: AppearanceSettings
  effective: EffectiveTheme
  /** The name of the global theme, for the "Global (…)" label. */
  globalThemeName: string
  setGlobalTheme(themeId: string): Promise<void>
  setModePreference(preference: ThemeModePreference): Promise<void>
  importThemeFile(file: File): Promise<{ theme: ThemeEntry; outcome: ThemeImportOutcome }>
  deleteTheme(themeId: string): Promise<void>
  /** Back to the built-in default and the system mode. Works whatever an imported theme did to the page. */
  resetAppearance(): Promise<void>
  /** Re-reads the stored library; the archive importer installs themes without going through this state. */
  refreshLibrary(): Promise<void>
}

const supportsCssValue: SupportsCssValue = (property, value) => typeof CSS === 'undefined' || CSS.supports(property, value)

function useSystemPrefersDark(enabled: boolean) {
  const query = useMemo(() => typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null, [])
  const [prefersDark, setPrefersDark] = useState(() => query?.matches ?? true)
  useEffect(() => {
    if (!enabled || !query) return
    const update = () => setPrefersDark(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [enabled, query])
  return prefersDark
}

export function useAppearanceState(activeMoment: Moment | null): AppearanceState {
  const [stored, setStored] = useState<StoredTheme[]>([])
  const [settings, setSettings] = useState<AppearanceSettings>({ globalThemeId: DEFAULT_THEME_ID, modePreference: 'system' })
  const [isReady, setIsReady] = useState(false)
  const systemPrefersDark = useSystemPrefersDark(settings.modePreference === 'system')

  const refreshLibrary = useCallback(async () => {
    setStored(await listStoredThemes())
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([listStoredThemes(), getAppearanceSettings()]).then(([themes, loaded]) => {
      if (cancelled) return
      setStored(themes)
      setSettings(loaded)
      setIsReady(true)
    }).catch(() => {
      // Storage failed to open; the moments layer reports that. The built-in
      // default is applied regardless, so the page is never unstyled.
      if (!cancelled) setIsReady(true)
    })
    return () => { cancelled = true }
  }, [])

  const library = useMemo(() => mergeLibrary(stored), [stored])
  const themes = useMemo(() => [...library.values()].map(toThemeEntry), [library])

  const effective = useMemo(() => resolveEffectiveTheme({
    momentThemeId: activeMoment?.themeId,
    appearance: settings,
    systemPrefersDark,
    themes: library,
    defaultThemeId: DEFAULT_THEME_ID,
  }), [activeMoment?.themeId, settings, systemPrefersDark, library])

  useEffect(() => { applyTheme(effective) }, [effective])

  const setGlobalTheme = useCallback(async (themeId: string) => {
    if (!library.has(themeId)) throw new Error('That theme is not installed.')
    await setGlobalThemeId(themeId)
    setSettings((current) => ({ ...current, globalThemeId: themeId }))
  }, [library])

  const setModePreference = useCallback(async (preference: ThemeModePreference) => {
    await setThemeModePreference(preference)
    setSettings((current) => ({ ...current, modePreference: preference }))
  }, [])

  const importThemeFile = useCallback(async (file: File) => {
    const definition = parseThemeFile(await file.text(), supportsCssValue)
    const result = await importStoredTheme(definition)
    await refreshLibrary()
    return { theme: toThemeEntry(result.theme.definition), outcome: result.outcome }
  }, [refreshLibrary])

  const deleteTheme = useCallback(async (themeId: string) => {
    await deleteStoredTheme(themeId)
    // Storage already moved the global choice off the deleted theme.
    setSettings(await getAppearanceSettings())
    await refreshLibrary()
  }, [refreshLibrary])

  const resetAppearance = useCallback(async () => {
    await setGlobalThemeId(DEFAULT_THEME_ID)
    await setThemeModePreference('system')
    setSettings({ globalThemeId: DEFAULT_THEME_ID, modePreference: 'system' })
  }, [])

  return useMemo<AppearanceState>(() => ({
    isReady,
    themes,
    settings,
    effective,
    globalThemeName: library.get(settings.globalThemeId)?.name ?? library.get(DEFAULT_THEME_ID)!.name,
    setGlobalTheme,
    setModePreference,
    importThemeFile,
    deleteTheme,
    resetAppearance,
    refreshLibrary,
  }), [isReady, themes, settings, effective, library, setGlobalTheme, setModePreference, importThemeFile, deleteTheme, resetAppearance, refreshLibrary])
}
