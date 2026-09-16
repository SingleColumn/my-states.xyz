import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderDefaultThemeCssBlock, withRegeneratedBlock } from './themeCss'
import { THEME_TOKEN_NAMES } from './tokens'

const themeCssPath = resolve(__dirname, '..', 'theme.css')

/**
 * theme.css's statement of the default theme is generated from
 * builtin/midnight.theme.json and committed, so the page has a complete
 * appearance before any JSON has been read and the two can never disagree.
 * When the default theme or the token spec changes, regenerate with:
 *
 *   UPDATE_THEME_CSS=1 npx vitest run src/themes/themeCss.test.ts
 */
describe('theme.css and the default theme', () => {
  it('agree: the generated block is current (regenerate with UPDATE_THEME_CSS=1)', () => {
    const current = readFileSync(themeCssPath, 'utf8')
    if (process.env.UPDATE_THEME_CSS) writeFileSync(themeCssPath, withRegeneratedBlock(current))
    expect(readFileSync(themeCssPath, 'utf8')).toBe(withRegeneratedBlock(current))
  })

  it('declare every themeable token exactly once, generated or by hand', () => {
    const css = readFileSync(themeCssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)![1]
    const declared = [...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1])
    const generated = [...renderDefaultThemeCssBlock().matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1])
    for (const name of THEME_TOKEN_NAMES) expect(declared.filter((candidate) => candidate === name), name).toHaveLength(1)
    // What the generator does not emit is exactly what is written by hand: aliases and fallthroughs.
    const byHand = declared.filter((name) => !generated.includes(name) && THEME_TOKEN_NAMES.includes(name))
    for (const name of byHand) {
      const value = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(root)![1].trim()
      expect(value.includes('var(') || value === 'initial', `${name} is neither generated nor an alias`).toBe(true)
    }
  })
})
