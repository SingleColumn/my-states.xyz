import { compileThemeMode } from './compile'
import { getBuiltInTheme, DEFAULT_THEME_ID } from './registry'
import { THEME_TOKEN_NAMES } from './tokens'

export const THEME_CSS_GENERATED_START = '  /* @generated from builtin/midnight.theme.json -- do not edit; see themeCss.test.ts */'
export const THEME_CSS_GENERATED_END = '  /* @generated end */'

/**
 * The block of theme.css that states the built-in default theme's values.
 * The design source of truth is the default theme's JSON; this turns it into
 * the stylesheet's fallback declarations so the two are one fact with one
 * write path rather than a pair kept equal by hand. Only tokens the default
 * theme actually sets are emitted, in the spec's order; aliases and
 * deliberate fallthroughs (`var(...)`, `initial`) stay hand-written in
 * theme.css after the block.
 */
export function renderDefaultThemeCssBlock(): string {
  const theme = getBuiltInTheme(DEFAULT_THEME_ID)!
  const mode = theme.modes.dark ?? theme.modes.light!
  const compiled = compileThemeMode(mode)
  const lines = THEME_TOKEN_NAMES.filter((name) => name in compiled).map((name) => `  ${name}: ${compiled[name]};`)
  return [THEME_CSS_GENERATED_START, ...lines, THEME_CSS_GENERATED_END].join('\n')
}

/** theme.css with its generated block replaced by a fresh one; throws when the markers are missing. */
export function withRegeneratedBlock(css: string): string {
  const start = css.indexOf(THEME_CSS_GENERATED_START)
  const end = css.indexOf(THEME_CSS_GENERATED_END)
  if (start < 0 || end < 0 || end < start) throw new Error('theme.css has no generated block to replace')
  // The file keeps whatever line ending it has (git may check it out with either).
  const eol = css.includes('\r\n') ? '\r\n' : '\n'
  return css.slice(0, start) + renderDefaultThemeCssBlock().split('\n').join(eol) + css.slice(end + THEME_CSS_GENERATED_END.length)
}
