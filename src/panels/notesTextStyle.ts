import { remarkStringifyOptionsCtx } from '@milkdown/core'
import type { Ctx } from '@milkdown/ctx'
import type { Mark, MarkType, Node as ProseNode } from '@milkdown/prose/model'
import type { EditorState } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { $markSchema, $remark } from '@milkdown/utils'

/**
 * The font, size and colour of selected words.
 *
 * General controls rather than a named style per effect, so that a writer can
 * make a look nobody thought to name. Each is a short list on purpose: the
 * values are words the stylesheet gives meaning to, never a font or a colour
 * written into the note, so a colour can be adjusted to stay readable on each
 * theme. It also means a note from elsewhere cannot put arbitrary
 * styling on the page, because only the values below are ever read.
 *
 * Markdown has none of this, so it travels as what Markdown allows for what it
 * lacks, as underline does -- inline HTML:
 *
 *     the <span data-font="serif" data-size="large">agreed</span> figure
 *
 * A reader that passes HTML through shows the words plain, since it has no
 * stylesheet for these; a strict reader shows the tags. No words are lost.
 *
 * One mark holding all three, not three marks, so they can never nest: remark
 * reads `</span>` as a loose scrap, and with one mark the first one found is
 * always the right one.
 */
export const textStyleChoices = {
  font: [
    { value: 'sans', label: 'Sans serif' },
    { value: 'serif', label: 'Serif' },
    { value: 'typewriter', label: 'Typewriter' },
  ],
  size: [
    { value: 'small', label: 'Small' },
    { value: 'large', label: 'Large' },
    { value: 'x-large', label: 'Extra large' },
  ],
  color: [
    { value: 'muted', label: 'Muted' },
    { value: 'amber', label: 'Amber' },
    { value: 'red', label: 'Red' },
    { value: 'blue', label: 'Blue' },
    { value: 'green', label: 'Green' },
  ],
} as const

export type TextStyleKind = keyof typeof textStyleChoices
type TextStyle = Record<TextStyleKind, string | null>

const KINDS = Object.keys(textStyleChoices) as TextStyleKind[]
const NODE_TYPE = 'noteTextStyle'
const CLOSE = '</span>'

function knownValue(kind: TextStyleKind, value: string | null | undefined) {
  return textStyleChoices[kind].some((choice) => choice.value === value) ? value as string : null
}

function hasAnyStyle(style: TextStyle) {
  return KINDS.some((kind) => style[kind] !== null)
}

export const textStyleSchema = $markSchema('textStyle', () => ({
  attrs: { font: { default: null }, size: { default: null }, color: { default: null } },
  parseDOM: [{
    tag: 'span',
    getAttrs: (dom) => {
      const element = dom as HTMLElement
      const style: TextStyle = {
        font: knownValue('font', element.dataset.font),
        size: knownValue('size', element.dataset.size),
        color: knownValue('color', element.dataset.color),
      }
      return hasAnyStyle(style) ? style : false
    },
  }],
  toDOM: (mark) => ['span', dataAttributes(mark.attrs as TextStyle)],
  parseMarkdown: {
    match: (node) => node.type === NODE_TYPE,
    runner: (state, node, markType) => {
      const { font = null, size = null, color = null } = node as unknown as Partial<TextStyle>
      state.openMark(markType, { font, size, color })
      state.next(node.children ?? [])
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'textStyle',
    runner: (state, mark) => {
      state.withMark(mark, NODE_TYPE, undefined, styleOf(mark))
    },
  },
}))

function styleOf(mark: Mark): TextStyle {
  const { font, size, color } = mark.attrs as TextStyle
  return { font, size, color }
}

function dataAttributes(style: TextStyle) {
  const attributes: Record<string, string> = {}
  for (const kind of KINDS) {
    const value = style[kind]
    if (value) attributes[`data-${kind}`] = value
  }
  return attributes
}

/** The value of one control for what is selected: for a mixed selection, its start. */
export function textStyleAt(state: EditorState, kind: TextStyleKind) {
  const type = state.schema.marks.textStyle
  if (!type) return null
  const { $from, from, to, empty } = state.selection
  if (empty) return (type.isInSet(state.storedMarks ?? $from.marks())?.attrs as TextStyle | undefined)?.[kind] ?? null
  let value: string | null | undefined
  state.doc.nodesBetween(from, to, (node) => {
    if (value === undefined && node.isText) value = (type.isInSet(node.marks)?.attrs as TextStyle | undefined)?.[kind] ?? null
    return value === undefined
  })
  return value ?? null
}

/**
 * Sets one of the three on what is selected, leaving the other two as each piece
 * of text already has them, which is why it goes piece by piece. With nothing
 * selected it applies to what is typed next, as bold does.
 */
export function applyTextStyle(view: EditorView, kind: TextStyleKind, value: string | null) {
  const { state } = view
  const type = state.schema.marks.textStyle
  if (!type) return
  const next = knownValue(kind, value)
  const { $from, empty, ranges } = state.selection
  let transaction = state.tr

  if (empty) {
    const current = type.isInSet(state.storedMarks ?? $from.marks())
    const style = withChoice(current, kind, next)
    transaction = hasAnyStyle(style)
      ? transaction.addStoredMark(type.create(style))
      : transaction.removeStoredMark(type)
    view.dispatch(transaction)
    return
  }

  for (const range of ranges) {
    const from = range.$from.pos
    const to = range.$to.pos
    state.doc.nodesBetween(from, to, (node: ProseNode, position: number) => {
      if (!node.isText) return true
      const start = Math.max(position, from)
      const end = Math.min(position + node.nodeSize, to)
      transaction = restyle(transaction, type, start, end, withChoice(type.isInSet(node.marks), kind, next))
      return false
    })
  }
  view.dispatch(transaction)
}

function withChoice(mark: Mark | undefined, kind: TextStyleKind, value: string | null): TextStyle {
  return { font: null, size: null, color: null, ...(mark ? styleOf(mark) : {}), [kind]: value }
}

function restyle(transaction: EditorState['tr'], type: MarkType, from: number, to: number, style: TextStyle) {
  return hasAnyStyle(style)
    ? transaction.addMark(from, to, type.create(style))
    : transaction.removeMark(from, to, type)
}

interface MdNode { type: string; children?: MdNode[]; value?: string; [key: string]: unknown }

/** Only what the handler passes on: a node with children to serialise. */
type StyleNode = MdNode & Partial<TextStyle>

/**
 * Pairs up the scraps of HTML remark leaves, as underline does. An opening tag
 * with anything but the known attributes and values is left alone, so it shows
 * as the characters it is rather than being half understood.
 */
export const textStyleRemark = $remark('notesTextStyleRemark', () => () => (root) => {
  const tree = root as unknown as MdNode
  tree.children = pairUp(tree.children ?? [])
})

function pairUp(children: MdNode[]): MdNode[] {
  const out: MdNode[] = []
  for (let index = 0; index < children.length; index++) {
    const child = children[index]
    const style = child.type === 'html' ? readOpeningTag(child.value) : null
    if (style) {
      const close = children.findIndex((other, at) => at > index && other.type === 'html' && other.value?.trim().toLowerCase() === CLOSE)
      if (close > index) {
        out.push({ type: NODE_TYPE, ...style, children: pairUp(children.slice(index + 1, close)) })
        index = close
        continue
      }
    }
    if (child.children) child.children = pairUp(child.children)
    out.push(child)
  }
  return out
}

/** The style in `<span data-font="serif">`, or null if it is not one of ours. */
export function readOpeningTag(tag: string | undefined): TextStyle | null {
  const match = /^<span((?:\s+data-[a-z]+="[a-z0-9-]+")+)\s*>$/i.exec(tag?.trim() ?? '')
  if (!match) return null
  const style: TextStyle = { font: null, size: null, color: null }
  for (const [, name, value] of match[1].matchAll(/data-([a-z]+)="([a-z0-9-]+)"/gi)) {
    const kind = KINDS.find((candidate) => candidate === name.toLowerCase())
    const known = kind ? knownValue(kind, value) : null
    if (!kind || !known) return null
    style[kind] = known
  }
  return style
}

function openingTag(style: Partial<TextStyle>) {
  const attributes = KINDS
    .filter((kind) => style[kind])
    .map((kind) => ` data-${kind}="${style[kind]}"`)
    .join('')
  return `<span${attributes}>`
}

/** Teaches remark to write the mark back out; see the same step in notesUnderline.ts. */
export function configureTextStyleStringify(ctx: Ctx) {
  const options = ctx.get(remarkStringifyOptionsCtx)
  const noteTextStyle: TextStyleHandler = (node, _parent, state, info) => {
    const tracker = state.createTracker(info)
    let value = tracker.move(openingTag(node))
    value += tracker.move(state.containerPhrasing(node, { before: value, after: '<', ...tracker.current() }))
    value += tracker.move(CLOSE)
    return value
  }
  ctx.set(remarkStringifyOptionsCtx, {
    ...options,
    handlers: { ...options.handlers, [NODE_TYPE]: noteTextStyle } as typeof options.handlers,
  })
}

/** What remark hands a handler, for the one node type it has never heard of. */
type TextStyleHandler = (
  node: StyleNode,
  parent: unknown,
  state: {
    createTracker: (info: unknown) => { move: (value: string) => string; current: () => object }
    containerPhrasing: (node: StyleNode, info: object) => string
  },
  info: unknown,
) => string
