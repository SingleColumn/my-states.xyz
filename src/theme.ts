/**
 * A theme is a data object, not a stylesheet.
 *
 * The built-in dark theme is written in theme.css. A custom theme is a map
 * from those same token names to values; applying it sets the tokens as
 * inline properties on the document root, which take precedence over the
 * stylesheet everywhere -- inside the canvas too, because theme.css hands
 * tldraw its colours from these tokens. Clearing the overrides returns to
 * the built-in theme with nothing else to undo.
 *
 * tldraw's own light/dark switch is part of the theme rather than a separate
 * setting: the bridge in theme.css is written for its dark scheme, so a
 * theme says which scheme it expects and App.tsx applies it on mount.
 */

export type ThemeTokens = Readonly<Record<`--${string}`, string>>

export interface Theme {
  name: string
  /** Which of tldraw's two colour schemes the bridge in theme.css is written for. */
  tldrawColorScheme: 'dark' | 'light'
  /** Overrides for the built-in values; an empty object is the built-in theme itself. */
  tokens: ThemeTokens
}

export const builtInTheme: Theme = {
  name: 'Dark',
  tldrawColorScheme: 'dark',
  tokens: {},
}

const appliedTokenNames = new Set<string>()

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  for (const name of appliedTokenNames) root.style.removeProperty(name)
  appliedTokenNames.clear()
  for (const [name, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(name, value)
    appliedTokenNames.add(name)
  }
}
