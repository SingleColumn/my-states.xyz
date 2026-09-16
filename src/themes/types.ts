/**
 * The theme data model. A theme is structured JSON (see theme.schema.json),
 * never a stylesheet: the compiler in compile.ts turns one of its modes into
 * values for the custom properties theme.css declares, and theme.ts sets
 * those on the document root. Nothing here knows a CSS selector.
 *
 * This module has no React and no DOM in it so storage, the archive format
 * and tests can all read it.
 */

export const THEME_SCHEMA_VERSION = 1

export type ThemeModeName = 'light' | 'dark'

export type ThemeModePreference = 'system' | 'light' | 'dark'

export interface ThemeDefinition {
  schemaVersion: typeof THEME_SCHEMA_VERSION
  /** Stable, author-chosen: `^[a-z0-9][a-z0-9-]*$`. Unique in the library. */
  id: string
  name: string
  /** The theme's own version, separate from the schema's. */
  version: string
  author?: string
  description?: string
  /** Informational only: no runtime inheritance. */
  derivedFrom?: string
  modes: {
    light?: ThemeMode
    dark?: ThemeMode
  }
}

/**
 * One mode of a theme. Every field is optional: a theme that sets only a
 * background stays coherent because the compiler derives what it can from
 * the layers below (application defaults -> foundation -> semantic ->
 * components) and leaves the rest to the stylesheet.
 */
export interface ThemeMode {
  foundation?: FoundationTokens
  semantic?: SemanticTokens
  components?: ComponentTokens
}

export interface FoundationTokens {
  color?: {
    background?: string
    foreground?: string
    muted?: string
    faint?: string
    accent?: string
    border?: string
    danger?: string
    selection?: string
  }
  typography?: {
    uiFont?: string
    headingFont?: string
    headingWeight?: string
    monoFont?: string
  }
  shape?: {
    radiusLarge?: string
    radiusMedium?: string
    radiusSmall?: string
  }
  depth?: {
    shadowSmall?: string
    shadowMedium?: string
    shadowLarge?: string
    backdropBlur?: string
  }
}

export interface SemanticTokens {
  surfacePrimary?: string
  surfaceElevated?: string
  surfaceOverlay?: string
  textPrimary?: string
  textSecondary?: string
  textMuted?: string
  textFaint?: string
  borderSubtle?: string
  borderNormal?: string
  borderStrong?: string
  focusRing?: string
  interactive?: string
  interactiveHover?: string
  interactiveActive?: string
  danger?: string
  accentLift?: string
}

export interface ComponentTokens {
  canvas?: {
    background?: string
    backdrop?: string
    gridColor?: string
    selectionStroke?: string
    selectionStrokeWidth?: string
  }
  panel?: {
    border?: string
    divider?: string
    frame?: string
    shellBorder?: string
    headerForeground?: string
    footerForeground?: string
    shadow?: string
    backdropBlur?: string
    contentBackground?: string
    texture?: 'none' | 'paper' | 'dots'
    ornament?: 'none' | 'bow' | 'star'
  }
  button?: {
    background?: string
    border?: string
    foreground?: string
    backgroundHover?: string
    backgroundActive?: string
    borderActive?: string
    foregroundActive?: string
  }
  control?: {
    background?: string
    border?: string
    borderHover?: string
    emptyBackground?: string
    emptyBackgroundHover?: string
    rangeAccent?: string
    rangeTrack?: string
    rangeThumb?: string
    rangeWell?: string
    rangeWellBorder?: string
    iconStrokeWidth?: string
  }
  input?: {
    background?: string
    foreground?: string
  }
  menu?: {
    background?: string
    surface?: string
  }
  toolbar?: {
    background?: string
    border?: string
    foreground?: string
    shadow?: string
    backdropBlur?: string
  }
  toast?: {
    background?: string
    border?: string
    foreground?: string
  }
  dialog?: {
    background?: string
    border?: string
    backdrop?: string
    shadow?: string
  }
  editor?: {
    background?: string
    border?: string
    toolbarBackground?: string
  }
  /**
   * One group per kind of panel, under the name its registry entry gives
   * (`spotify`, `images`, `notes`, ...). Every panel accepts `accent` and
   * `panelBackground`; the rest is declared by the panel itself in
   * panelRegistry.ts and documented in theme.schema.json.
   */
  [panel: string]: Record<string, string | undefined> | undefined
}

/** A theme the user brought in, as the database keeps it. Built-ins are never stored. */
export interface StoredTheme {
  id: string
  name: string
  version: string
  schemaVersion: number
  source: 'imported' | 'user'
  definition: ThemeDefinition
  createdAt: number
  updatedAt: number
}

/** What the library lists: enough to fill a picker without the definition. */
export interface ThemeEntry {
  id: string
  name: string
  version: string
  builtIn: boolean
  modes: ThemeModeName[]
}

export interface AppearanceSettings {
  globalThemeId: string
  modePreference: ThemeModePreference
}

/**
 * The one answer to "which theme is on screen". Resolved in resolve.ts from
 * the open moment, the appearance settings, the library and the system
 * colour scheme; nothing else decides precedence.
 */
export interface EffectiveTheme {
  themeId: string
  mode: ThemeModeName
  /** Where the choice came from: the moment's own pin, the app setting, or the built-in default because neither was installed. */
  source: 'moment' | 'global' | 'fallback'
  /** Set when the moment pins a theme that is not installed; its id is kept, not cleared. */
  missingThemeId?: string
  definition: ThemeDefinition
}
