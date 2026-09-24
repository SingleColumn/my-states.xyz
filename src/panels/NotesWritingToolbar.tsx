import { Bold, Code, Highlighter, Image as ImageIcon, Italic, Link as LinkIcon, Minus, Smile, Underline as UnderlineIcon } from 'lucide-react'
import { commandsCtx, editorViewCtx } from '@milkdown/core'
import type { Ctx } from '@milkdown/ctx'
import {
  insertImageCommand,
  liftListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark'
import { lift } from '@milkdown/prose/commands'
import type { EditorState } from '@milkdown/prose/state'
import { usePluginViewContext } from '@prosemirror-adapter/react'
import { markPointerEventHandled, panelContentProps } from '../panelSurface'
import { useNotesEditorActions } from './notesEditorActions'
import { FormatButton, isMarkActive } from './NotesFormattingTooltip'
import { canEditLink, isOnLink } from './NotesLinkEditor'
import { insertDivider, pickImageFile } from './NotesInsertMenu'
import { toggleUnderlineCommand } from './notesUnderline'
import { toggleHighlightCommand } from './notesHighlight'

/**
 * The writing tools, always on show above the note.
 *
 * The right-click bar and the slash menu between them can already do
 * everything here, and they stay -- but both are gestures a writer has to
 * be told about, and a note is for people who have never heard of Markdown.
 * Nothing that can only be reached by knowing a secret counts as offered.
 * So the things a writer looks for are here in plain sight, and the two
 * hidden routes become what they should have been all along: shortcuts for
 * people who already know them.
 *
 * Everything it offers is on it. An earlier version put the insertions
 * behind a plus, which opened a list over the writing -- a bar whose
 * options are themselves hidden is only the same problem one layer down,
 * and the list covered the words a writer was looking at while choosing.
 * The one exception is the emoji, which has to be picked from somewhere;
 * that list opens at the caret, as it does when `:` is typed.
 *
 * It is a plugin view rather than an ordinary component so that it re-reads
 * the editor after every keystroke and selection change -- which is what
 * lets the style menu say what the line under the caret currently is, and
 * the mark buttons say whether they are on. It renders into a host element
 * the panel puts above the writing; see `toolbarHost` in NotesEditor.
 */
export function NotesWritingToolbar() {
  const { view } = usePluginViewContext()
  const { run, openEmojiList, openLinkEditor } = useNotesEditorActions()
  const { state } = view
  const marks = state.schema.marks
  const style = blockStyleOf(state)

  function choose(next: BlockStyle) {
    run((ctx) => {
      setBlockStyle(ctx, next)
      ctx.get(editorViewCtx).focus()
    })
  }

  return (
    <div className="notes-writing-toolbar" role="toolbar" aria-label="Writing tools" onPointerDown={markPointerEventHandled} {...panelContentProps}>
      <select
        className="notes-style-select"
        aria-label="Style of this line"
        title="What this line is"
        value={style}
        // The press is swallowed on the buttons so the selection survives;
        // a select has to keep its own pointer handling to open at all, and
        // the command it runs puts the caret back afterwards.
        onChange={(event) => choose(event.target.value as BlockStyle)}
      >
        {blockStyles.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <span className="notes-writing-group">
      <FormatButton label="Bold" active={isMarkActive(state, marks.strong)} onActivate={() => run((ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key))}>
        <Bold size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Italic" active={isMarkActive(state, marks.emphasis)} onActivate={() => run((ctx) => ctx.get(commandsCtx).call(toggleEmphasisCommand.key))}>
        <Italic size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Underline" active={isMarkActive(state, marks.underline)} onActivate={() => run((ctx) => ctx.get(commandsCtx).call(toggleUnderlineCommand.key))}>
        <UnderlineIcon size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Highlight" active={isMarkActive(state, marks.highlight)} onActivate={() => run((ctx) => ctx.get(commandsCtx).call(toggleHighlightCommand.key))}>
        <Highlighter size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Code" active={isMarkActive(state, marks.inlineCode)} onActivate={() => run((ctx) => ctx.get(commandsCtx).call(toggleInlineCodeCommand.key))}>
        <Code size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Link" active={isOnLink(state)} disabled={!canEditLink(state)} onActivate={openLinkEditor}>
        <LinkIcon size={16} aria-hidden="true" />
      </FormatButton>
      </span>

      <span className="notes-writing-group">
      <FormatButton label="Divider" active={false} onActivate={() => run((ctx) => { insertDivider(ctx); ctx.get(editorViewCtx).focus() })}>
        <Minus size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Emoji" active={false} onActivate={openEmojiList}>
        <Smile size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Picture" active={false} onActivate={() => run((ctx) => pickImageFile((src, alt) => {
        ctx.get(commandsCtx).call(insertImageCommand.key, { src, alt, title: '' })
        ctx.get(editorViewCtx).focus()
      }))}>
        <ImageIcon size={16} aria-hidden="true" />
      </FormatButton>
      </span>
    </div>
  )
}

type BlockStyle = 'text' | 'h1' | 'h2' | 'h3' | 'quote' | 'bullets' | 'numbers'

/** In the order a writer reaches for them, plainest first. */
const blockStyles: Array<{ value: BlockStyle; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'h1', label: 'Heading' },
  { value: 'h2', label: 'Subheading' },
  { value: 'h3', label: 'Small heading' },
  { value: 'quote', label: 'Quote' },
  { value: 'bullets', label: 'Bulleted list' },
  { value: 'numbers', label: 'Numbered list' },
]

/**
 * What the line holding the caret is. The list and the quote are read from
 * the ancestors rather than the parent, because the caret's own parent
 * inside either of them is an ordinary paragraph.
 */
function blockStyleOf(state: EditorState): BlockStyle {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name
    if (name === 'bullet_list') return 'bullets'
    if (name === 'ordered_list') return 'numbers'
    if (name === 'blockquote') return 'quote'
  }
  const parent = $from.parent
  if (parent.type.name === 'heading') {
    const level = parent.attrs.level as number
    return level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
  }
  return 'text'
}

/**
 * Makes the line the style asked for, whatever it is now.
 *
 * Every style is reached from plain text, so the line is taken back to
 * plain text first. That is the part Markdown shortcuts never offered and
 * the reason this menu exists: typing `-` starts a list and there is no
 * character that ends one, so a writer who wanted a paragraph after a list
 * had to guess at pressing Enter on an empty bullet.
 */
function setBlockStyle(ctx: Ctx, style: BlockStyle) {
  const commands = ctx.get(commandsCtx)
  const view = ctx.get(editorViewCtx)
  // Out of any list, one level at a time, then out of any quote. Bounded by
  // the depth it started at so a command that stops making progress cannot
  // spin here.
  for (let guard = view.state.selection.$from.depth; guard > 0; guard--) {
    if (!commands.call(liftListItemCommand.key)) break
  }
  for (let guard = view.state.selection.$from.depth; guard > 0; guard--) {
    if (!lift(view.state, view.dispatch)) break
  }
  commands.call(turnIntoTextCommand.key)

  if (style === 'h1' || style === 'h2' || style === 'h3') commands.call(wrapInHeadingCommand.key, Number(style.slice(1)))
  else if (style === 'quote') commands.call(wrapInBlockquoteCommand.key)
  else if (style === 'bullets') commands.call(wrapInBulletListCommand.key)
  else if (style === 'numbers') commands.call(wrapInOrderedListCommand.key)
}
