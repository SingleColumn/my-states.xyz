const allowedProperties = new Set(['visibility', 'color', 'background-color', 'opacity', 'text-shadow', 'filter', 'transition', 'transition-duration', 'animation', 'animation-name', 'animation-duration', 'animation-delay', 'animation-timing-function', 'animation-iteration-count'])
const wordSelector = /^\.word(?:\[(?:data-index|data-word-count|data-revealed|data-illuminated)=(?:"[\w-]+"|'[\w-]+'|[\w-]+)\])?$/

/** CSSOM parsing handles escaped tokens before the allowlist is checked. */
export function validateAnimationCss(source: string): string {
  if (source.length > 20_000) throw new Error('CSS is too long.')
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(source)
  if (!sheet.cssRules.length && source.trim()) throw new Error('Add a rule for .word.')
  for (const rule of sheet.cssRules) {
    if (rule instanceof CSSStyleRule) {
      if (!rule.selectorText.split(',').every(selector => wordSelector.test(selector.trim()))) throw new Error('CSS selectors must target .word and its documented data attributes.')
      checkDeclarations(rule.style)
    } else if (rule instanceof CSSKeyframesRule) {
      if (!/^[a-zA-Z][\w-]*$/.test(rule.name)) throw new Error('Use a simple animation name.')
      for (const frame of rule.cssRules) {
        if (!(frame instanceof CSSKeyframeRule)) throw new Error('Unsupported CSS rule.')
        checkDeclarations(frame.style)
      }
    } else throw new Error('Only word rules and keyframes are allowed.')
  }
  return Array.from(sheet.cssRules, rule => rule.cssText).join('\n')
}

function checkDeclarations(style: CSSStyleDeclaration) {
  for (let index = 0; index < style.length; index++) {
    const property = style.item(index)
    const value = style.getPropertyValue(property)
    if (!allowedProperties.has(property) || /url\s*\(|image\s*\(|expression\s*\(/i.test(value) || style.getPropertyPriority(property)) {
      throw new Error(`Unsupported CSS property or value: ${property}.`)
    }
  }
}
