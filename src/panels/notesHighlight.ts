import { commandsCtx, remarkStringifyOptionsCtx } from '@milkdown/core'
import type { Ctx } from '@milkdown/ctx'
import { toggleMark } from '@milkdown/prose/commands'
import { markRule } from '@milkdown/prose'
import { $command, $inputRule, $markSchema, $remark, $useKeymap } from '@milkdown/utils'

/**
 * Highlighting: a wash over words a writer wants to come back to.
 *
 * CommonMark has no highlight and GFM did not add one, but `==like this==`
 * is the convention that grew up around the gap -- Obsidian, Typora, Bear
 * and markdown-it-mark all read it -- so that is what a note is written
 * with. It is the one choice here that needs defending, because the
 * alternative was `<mark>`, which more readers render.
 *
 * `==` wins on the grounds the checklist sets out: a note that uses it is
 * still Markdown rather than Markdown with HTML in it, and where the
 * convention is not known the degradation is plain and predictable -- the
 * words are all there, wearing two equals signs. `<mark>` would render in
 * more places at the cost of putting a tag in the file, which is the trade
 * the checklist asks us not to make.
 *
 * The same three pieces as the underline: the mark, a handler that writes
 * it, and a transform that reads it back -- remark has no idea what `==` is,
 * so it arrives as ordinary text and has to be split out again.
 */
export const highlightSchema = $markSchema('highlight', () => ({
  parseDOM: [
    { tag: 'mark' },
    // Word and Google Docs paste the colour rather than the tag.
    { style: 'background-color', getAttrs: (value) => (value !== '' && value !== 'transparent') as false },
  ],
  toDOM: () => ['mark'],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children ?? [])
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'highlight')
    },
  },
}))

export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => () => toggleMark(highlightSchema.type(ctx)))

/**
 * `Mod-Shift-h`, which is what the editors that have a highlight tend to
 * use. Not a platform convention the way Mod-b is -- there is none -- so it
 * is a choice rather than an expectation.
 */
export const highlightKeymap = $useKeymap('highlightKeymap', {
  ToggleHighlight: {
    shortcuts: 'Mod-Shift-h',
    command: (ctx) => () => ctx.get(commandsCtx).call(toggleHighlightCommand.key),
  },
})

/**
 * Typing the convention makes the mark, as typing `*` makes an emphasis.
 *
 * The same rule the reader applies, and for the same reason: without the
 * two whitespace guards, `a == b` followed by any later `==` on the line
 * closed a highlight over everything between them, so arithmetic turned
 * itself into a highlight as it was typed.
 */
export const highlightInputRule = $inputRule((ctx) => markRule(
  // The character before is excluded so `===` cannot open one; the content
  // may not be empty, hold an equals sign, or touch either marker with a
  // space.
  /(?:^|[^=])==(?!\s)([^=]+)(?<!\s)==$/,
  highlightSchema.type(ctx),
  {
    updateCaptured: ({ fullMatch, start }) => fullMatch.startsWith('==') ? {} : { fullMatch: fullMatch.slice(1), start: start + 1 },
  },
))

const MARKER = '=='

interface MdNode { type: string; children?: MdNode[]; value?: string; [key: string]: unknown }

/**
 * Splits `==like this==` back out of the text remark hands over.
 *
 * Unlike the underline's tags, which arrive as their own scraps of HTML,
 * this is ordinary text: remark has no rule for `==`, so a paragraph comes
 * through as one text node with the markers still in it. Only text nodes
 * are split, which is what keeps the markers literal inside inline code and
 * code blocks -- those are nodes of their own, carrying a value rather than
 * text children.
 */
export const highlightRemark = $remark('notesHighlightRemark', () => () => (root) => {
  const tree = root as unknown as MdNode
  visit(tree)
})

function visit(node: MdNode) {
  if (!node.children) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...split(child.value))
      continue
    }
    visit(child)
    next.push(child)
  }
  node.children = next
}

/** One text node becomes text, highlight, text, … as the markers divide it. */
function split(value: string): MdNode[] {
  const out: MdNode[] = []
  // No equals signs inside, and no space against the markers, which is the
  // rule every reader of this convention applies.
  const pattern = /==(?!\s)([^=]+)(?<!\s)==/g
  let at = 0
  for (const match of value.matchAll(pattern)) {
    const start = match.index
    if (start > at) out.push({ type: 'text', value: value.slice(at, start) })
    out.push({ type: 'highlight', children: [{ type: 'text', value: match[1] }] })
    at = start + match[0].length
  }
  if (at < value.length) out.push({ type: 'text', value: value.slice(at) })
  return out.length > 0 ? out : [{ type: 'text', value }]
}

/**
 * Teaches remark to write the mark. Called from the editor's config, the
 * last moment the stringify options can be changed.
 */
export function configureHighlightStringify(ctx: Ctx) {
  const options = ctx.get(remarkStringifyOptionsCtx)
  const highlight: HighlightHandler = (node, _parent, state, info) => {
    const tracker = state.createTracker(info)
    let value = tracker.move(MARKER)
    value += tracker.move(state.containerPhrasing(node, { before: value, after: '=', ...tracker.current() }))
    value += tracker.move(MARKER)
    return value
  }
  ctx.set(remarkStringifyOptionsCtx, {
    ...options,
    handlers: { ...options.handlers, highlight } as typeof options.handlers,
  })
}

/** Only what the handler passes on: a node with children to serialise. */
interface Parent { type: string; children?: unknown[] }

/** What remark hands a handler, for a node type it has never heard of. */
type HighlightHandler = (
  node: Parent,
  parent: unknown,
  state: {
    createTracker: (info: unknown) => { move: (value: string) => string; current: () => object }
    containerPhrasing: (node: Parent, info: object) => string
  },
  info: unknown,
) => string
