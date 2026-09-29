import { nextDuplicateName } from './utils'

/**
 * The Markdown half of the rule that the first visible line names a note.
 *
 * The editor enforces the same rule on ProseMirror nodes. Keeping every
 * Markdown-only path here prevents imports, commands and copies from each
 * inventing a slightly different idea of what the editor will display.
 */

const NON_NAMEABLE_BLOCK = /^(?: {4}|\t|\s*(?:[-*+]\s|\d+[.)]\s|>|```|~~~|\||:{3}|(?:-\s*){3,}$|(?:\*\s*){3,}$|(?:_\s*){3,}$))/
const EMBED_LINE = /^\s*\[[^\]]*\]\(my-states:\/\/panel\/[^)]+\)\s*$/
const TABLE_DIVIDER = /^\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/
const LINK_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*\S/
const HTML_BLOCK = /^\s{0,3}(?:<!--|<\?|<![A-Z]|<!\[CDATA\[|<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>))/i

export function firstMarkdownLine(markdown: string) {
  return markdown.split('\n', 1)[0] ?? ''
}

/** Whether the first Markdown block becomes a text line in the editor. */
export function markdownFirstBlockCanName(markdown: string) {
  const [firstLine = '', secondLine = ''] = markdown.split('\n', 2)
  if (NON_NAMEABLE_BLOCK.test(firstLine) || EMBED_LINE.test(firstLine) || LINK_DEFINITION.test(firstLine) || HTML_BLOCK.test(firstLine)) return false
  if (firstLine.includes('|') && TABLE_DIVIDER.test(secondLine)) return false

  const source = firstLine.replace(/^\s{0,3}#{1,6}(?:\s+|$)/, '').trim()
  // A genuinely empty paragraph is the place reserved for a future name.
  if (!source) return true
  // Images and other non-text inline content sit inside a paragraph in
  // ProseMirror, but replacing that paragraph would destroy the content.
  return firstLineAsText(firstLine) !== ''
}

/** The name the editor will derive after it parses this Markdown. */
export function noteTitleFromMarkdown(markdown: string) {
  return markdownFirstBlockCanName(markdown) ? firstLineAsText(firstMarkdownLine(markdown)) : ''
}

/** A heading whose displayed text is exactly the supplied name. */
export function markdownHeadingForText(name: string) {
  const literal = name.trim()
    .replace(/&/g, '&amp;')
    .replace(/[\\`*_[\]<>~=#]/g, '\\$&')
  return literal ? `# ${literal}` : ''
}

/**
 * A Markdown line as readable text. Escaped punctuation is protected before
 * formatting markers are removed, so a literal name such as `2 * 3` remains
 * `2 * 3` after remark serialises it as `2 \\* 3`.
 */
export function firstLineAsText(line: string) {
  const protectedCharacters: string[] = []
  const protect = (_match: string, character: string) => {
    const index = protectedCharacters.push(character) - 1
    return `\uE000${index}\uE001`
  }

  return line
    .replace(/^\s{0,3}#{1,6}(?:\s+|$)/, '')
    .replace(/(`+)(.*?)\1/g, (_match, _ticks: string, content: string) => protect('', content))
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/g, protect)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<([^ >]+@[^ >]+)>/g, '$1')
    .replace(/<((?:https?:\/\/)[^ >]+)>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[*_~`=]/g, '')
    .replace(/\uE000(\d+)\uE001/g, (_match, index: string) => protectedCharacters[Number(index)] ?? '')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/&(?:lt|#60);/gi, '<')
    .replace(/&(?:gt|#62);/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim()
}

/** Writes a collision-free copy name into the same first-line structure. */
export function markdownNamedAsCopy(content: string, taken: readonly string[]) {
  const [firstLine = '', ...rest] = content.split('\n')
  if (!markdownFirstBlockCanName(content)) {
    return [nextDuplicateName('Untitled note', taken), '', firstLine, ...rest].join('\n')
  }

  const marker = /^\s{0,3}#{1,6}\s+/.exec(firstLine)?.[0] ?? ''
  const displayed = firstLineAsText(firstLine)
  const named = nextDuplicateName(displayed || 'Untitled note', taken)
  // The suffix lives outside the existing inline Markdown. Rebuilding the
  // line from displayed text would silently remove bold, links and code.
  const suffix = displayed ? named.slice(displayed.length) : named
  const rewritten = displayed ? `${firstLine.trimEnd()}${suffix}` : `${marker}${named}`
  return [rewritten, ...rest].join('\n')
}
