/**
 * Where a theme meets the page.
 *
 * The built-in values are written in theme.css. A resolved theme (see
 * themes/resolve.ts) is compiled to a map from those same custom-property
 * names to values, and applying it sets them as inline properties on the
 * document root, which take precedence over the stylesheet everywhere --
 * inside the canvas too, because theme.css hands tldraw its colours from
 * these tokens. Properties the theme does not set are removed again, so the
 * stylesheet's built-in value shows through; applying the built-in Midnight
 * theme sets values identical to the stylesheet's.
 *
 * The mode is written as `data-theme-mode` on the root, which theme.css
 * reads for `color-scheme`; tldraw's own light/dark switch is set from
 * App.tsx because it lives in the editor's user preferences, not the DOM.
 * A theme's style choices (how a header is drawn, say) are written as
 * `data-<name>` attributes on the root too, and styles.css selects on them.
 */

import { compileThemeAttributes, compileThemeMode } from './themes/compile'
import { THEME_ATTRIBUTE_NAMES } from './themes/tokens'
import type { EffectiveTheme } from './themes/types'

const appliedTokenNames = new Set<string>()

export function applyTheme(theme: EffectiveTheme, root: HTMLElement = document.documentElement) {
  const mode = theme.definition.modes[theme.mode]
  const tokens = mode ? compileThemeMode(mode) : {}
  for (const name of appliedTokenNames) {
    if (!(name in tokens)) root.style.removeProperty(name)
  }
  appliedTokenNames.clear()
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value)
    appliedTokenNames.add(name)
  }
  root.dataset.theme = theme.themeId
  root.dataset.themeMode = theme.mode
  // Style choices ride on the root as attributes; one not named by this
  // theme is removed, so the stylesheet's first option applies.
  const attributes = mode ? compileThemeAttributes(mode) : {}
  for (const name of THEME_ATTRIBUTE_NAMES) {
    if (name in attributes) root.setAttribute(`data-${name}`, attributes[name])
    else root.removeAttribute(`data-${name}`)
  }
}
