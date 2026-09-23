import { commandsCtx, remarkStringifyOptionsCtx } from '@milkdown/core'
import type { Ctx } from '@milkdown/ctx'
import { toggleMark } from '@milkdown/prose/commands'
import { $command, $markSchema, $remark, $useKeymap } from '@milkdown/utils'

/**
 * Underline: the one thing writers ask for that Markdown does not have.
 *
 * CommonMark has bold, italic and code, and GFM adds strikethrough; there
 * is no underline, because in print an underline is what a typewriter did
 * instead of italics. A note is still a place people expect it, so it is
 * added here as the one thing Markdown does allow for what it lacks --
 * inline HTML:
 *
 *     the <u>agreed</u> figure
 *
 * That is the honest cost of this feature, and it is worth stating plainly:
 * a note that uses it is no longer plain Markdown. Every reader that passes
 * HTML through (GitHub, most site generators, Obsidian, Typora) shows the
 * underline; a strict CommonMark-only reader shows the tags. No words are
 * lost either way, which is the degradation the rest of this format aims
 * for.
 *
 * Three pieces are needed, because remark has no idea what underline is:
 * the mark itself, a handler that writes it back out as those tags, and a
 * transform that reads them in again -- remark parses `<u>` and `</u>` as
 * two loose scraps of HTML with the words between them, not as a pair.
 */
export const underlineSchema = $markSchema('underline', () => ({
  parseDOM: [
    { tag: 'u' },
    // Word and Google Docs paste the style rather than the tag.
    { style: 'text-decoration', getAttrs: (value) => (value === 'underline') as false },
  ],
  toDOM: () => ['u'],
  parseMarkdown: {
    match: (node) => node.type === 'underline',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children ?? [])
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, mark) => {
      state.withMark(mark, 'underline')
    },
  },
}))

export const toggleUnderlineCommand = $command('ToggleUnderline', (ctx) => () => toggleMark(underlineSchema.type(ctx)))

/** `Mod-u`, the shortcut every word processor uses for it. */
export const underlineKeymap = $useKeymap('underlineKeymap', {
  ToggleUnderline: {
    shortcuts: 'Mod-u',
    command: (ctx) => () => ctx.get(commandsCtx).call(toggleUnderlineCommand.key),
  },
})

const OPEN = '<u>'
const CLOSE = '</u>'

interface MdNode { type: string; children?: MdNode[]; value?: string; [key: string]: unknown }

/**
 * Pairs up the scraps. Reading `a <u>b</u> c` remark gives a paragraph of
 * five children -- text, html `<u>`, text, html `</u>`, text -- and the
 * parser would hand the two html ones to the preset's html node, which
 * shows them as the literal characters. Pairing them into one `underline`
 * node before the parser looks is the same move the panel embed makes, one
 * step earlier than the schema.
 */
export const underlineRemark = $remark('notesUnderlineRemark', () => () => (root) => {
  const tree = root as unknown as MdNode
  tree.children = pairUp(tree.children ?? [])
})

function pairUp(children: MdNode[]): MdNode[] {
  const out: MdNode[] = []
  for (let index = 0; index < children.length; index++) {
    const child = children[index]
    if (isTag(child, OPEN)) {
      const close = children.findIndex((other, at) => at > index && isTag(other, CLOSE))
      if (close > index) {
        out.push({ type: 'underline', children: pairUp(children.slice(index + 1, close)) })
        index = close
        continue
      }
    }
    if (child.children) child.children = pairUp(child.children)
    out.push(child)
  }
  return out
}

function isTag(node: MdNode, tag: string) {
  return node.type === 'html' && typeof node.value === 'string' && node.value.trim().toLowerCase() === tag
}

/**
 * Teaches remark to write the mark back out. Called from the editor's
 * config, which is the last moment the stringify options can be changed:
 * the remark instance is built from them once, after config and before the
 * editor exists.
 */
export function configureUnderlineStringify(ctx: Ctx) {
  const options = ctx.get(remarkStringifyOptionsCtx)
  ctx.set(remarkStringifyOptionsCtx, {
    ...options,
    handlers: {
      ...options.handlers,
      underline: (node, _parent, state, info) => {
        const tracker = state.createTracker(info)
        let value = tracker.move(OPEN)
        value += tracker.move(state.containerPhrasing(node as never, { before: value, after: '<', ...tracker.current() }))
        value += tracker.move(CLOSE)
        return value
      },
    },
  })
}
