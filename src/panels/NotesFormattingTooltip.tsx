import { useOpenWordGraph } from '../wordGraph/WordGraphController'
import { captureWordSelection } from '../wordGraph/wordGraphSelection'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Bold, ClipboardPaste, Code, Copy, Heading1, Heading2, Heading3, Highlighter, Italic, Link as LinkIcon, Pilcrow, Quote, Scissors, Underline as UnderlineIcon } from 'lucide-react'
import { commandsCtx, editorViewCtx } from '@milkdown/core'
import { tooltipFactory, TooltipProvider } from '@milkdown/plugin-tooltip'
import {
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInHeadingCommand,
} from '@milkdown/preset-commonmark'
import type { EditorState } from '@milkdown/prose/state'
import { DOMParser as ProseDOMParser, type MarkType } from '@milkdown/prose/model'
import { usePluginViewContext } from '@prosemirror-adapter/react'
import { markPointerEventHandled } from '../panelSurface'
import { useNotesEditorActions } from './notesEditorActions'
import { toggleUnderlineCommand } from './notesUnderline'
import { toggleHighlightCommand } from './notesHighlight'
import { pastePlainText } from './notesClipboard'
import { canEditLink, isOnLink } from './NotesLinkEditor'
import { blockStyleOf, setBlockStyle } from './NotesWritingToolbar'
import { applyTextStyle, textStyleAt, textStyleChoices, type TextStyleKind } from './notesTextStyle'

/**
 * The contextual writing menu is asked for by right-clicking. Alongside
 * formatting it offers the clipboard actions that replacing the browser's
 * menu would otherwise take away.
 *
 * It sits in one place, along the bottom of the window, rather than beside the
 * words, where a bar this long covered the writing around them. Milkdown's
 * tooltip plugin only says when it shows; the stylesheet says where.
 *
 * It is mounted on `document.body`, not inside the panel. The panel body clips
 * its overflow, and outside tldraw's scaled layer the bar keeps the same size
 * as the rest of the app's chrome whatever the canvas zoom.
 */
export const formattingTooltip = tooltipFactory('notesFormatting')

export function NotesFormattingTooltip() {
  const ref = useRef<HTMLDivElement>(null)
  const provider = useRef<TooltipProvider>()
  const { view, prevState } = usePluginViewContext()
  const viewRef = useRef(view)
  viewRef.current = view
  const openWordGraph = useOpenWordGraph()
  const { run, openLinkEditor } = useNotesEditorActions()
  const [clipboardError, setClipboardError] = useState('')
  // Whether the writer has asked for the bar. A ref rather than state: the
  // provider's shouldShow, made once, reads it.
  const isOpen = useRef(false)
  // Set by the font, size and colour menus. A look is usually several choices
  // in a row, so unlike the other tools one of them does not close the bar.
  const keepOpenAfterEdit = useRef(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    provider.current = new TooltipProvider({
      content: element,
      root: document.body,
      debounce: 0,
      // The bar is asked for, never offered: an update only keeps it up
      // while the request stands.
      shouldShow: () => isOpen.current,
    })
    // A press anywhere else is the writer moving on, so the request has lapsed.
    // A wheel is not: the bar is not attached to anything that it moves.
    const onPointerDown = (event: PointerEvent) => {
      if (element.contains(event.target as Node) || !isOpen.current) return
      isOpen.current = false
      provider.current?.hide()
    }
    window.addEventListener('pointerdown', onPointerDown, true)

    // The request itself. The browser's menu is given up here, which is the
    // trade this makes.
    //
    // In the capture phase, so the editor claims the gesture on the way down
    // rather than waiting for it to come back up. React attaches its own
    // listeners to every portal container, and a picture is drawn by a node
    // view that is a portal -- so the panel's React handler runs *inside*
    // the editor, and the stopPropagation it makes to keep the canvas menu
    // away was killing this before it ever fired.
    const editorDom = viewRef.current.dom
    const onContextMenu = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      setClipboardError('')
      isOpen.current = true
      provider.current?.show()
    }
    editorDom.addEventListener('contextmenu', onContextMenu, { capture: true })

    return () => {
      editorDom.removeEventListener('contextmenu', onContextMenu, { capture: true })
      window.removeEventListener('pointerdown', onPointerDown, true)
      provider.current?.destroy()
    }
  }, [])

  // The adapter re-renders after every editor transaction. An edit answers
  // the request the bar was opened for, so it closes; a bare selection
  // change leaves it alone, since the writer may be choosing what to format.
  useEffect(() => {
    const keepOpen = keepOpenAfterEdit.current
    keepOpenAfterEdit.current = false
    if (!keepOpen && isOpen.current && prevState && !prevState.doc.eq(view.state.doc)) {
      isOpen.current = false
      provider.current?.hide()
      return
    }
    provider.current?.update(view, prevState)
  })

  const { state } = view
  const wordSelection = captureWordSelection(state)
  const marks = state.schema.marks
  const block = blockOf(state)
  const isQuote = blockStyleOf(state) === 'quote'

  function chooseTextStyle(kind: TextStyleKind, value: string) {
    keepOpenAfterEdit.current = true
    applyTextStyle(viewRef.current, kind, value || null)
    // Back to the editor, which still holds the selection the menu acted on.
    viewRef.current.focus()
  }

  function setBlock(level: number) {
    run((ctx) => {
      const commands = ctx.get(commandsCtx)
      // Level 0 is the way back: a heading turned into ordinary writing.
      if (level === 0) commands.call(turnIntoTextCommand.key)
      else commands.call(wrapInHeadingCommand.key, level)
      ctx.get(editorViewCtx).focus()
    })
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    isOpen.current = false
    provider.current?.hide()
    run((ctx) => ctx.get(editorViewCtx).focus())
  }

  function editClipboard(command: 'cut' | 'copy') {
    const editor = viewRef.current
    editor.focus()
    if (!document.execCommand(command)) {
      setClipboardError(`Could not ${command}. Use the keyboard shortcut instead.`)
      return
    }
    setClipboardError('')
    isOpen.current = false
    provider.current?.hide()
  }

  async function paste(plain: boolean) {
    try {
      const editor = viewRef.current
      const clipboard = navigator.clipboard
      if (!clipboard) throw new Error('Clipboard unavailable')
      let text = ''
      let html = ''
      if (!plain && clipboard.read) {
        try {
          const items = await clipboard.read()
          for (const item of items) {
            if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text()
            if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text()
            if (text || html) break
          }
        } catch {
          // Some browsers allow text reads but not the richer read method.
          text = await clipboard.readText()
        }
      } else {
        text = await clipboard.readText()
      }
      if (!text && !html) return
      // ProseMirror marks its own copied HTML. Keep that formatting, while
      // outside HTML goes in as words rather than bringing page styles along.
      if (!plain && html.includes('data-pm-slice')) {
        const template = document.createElement('template')
        template.innerHTML = html
        const slice = ProseDOMParser.fromSchema(editor.state.schema).parseSlice(template.content)
        editor.dispatch(editor.state.tr.replaceSelection(slice).scrollIntoView())
      } else {
        pastePlainText(editor, text)
      }
      editor.focus()
      setClipboardError('')
      isOpen.current = false
      provider.current?.hide()
    } catch {
      setClipboardError('Clipboard access was blocked. Use Ctrl+V instead.')
    }
  }

  return (
    <div ref={ref} className="notes-formatting-tooltip" role="toolbar" aria-label="Formatting" data-show="false" onKeyDown={handleKeyDown} onPointerDown={markPointerEventHandled}>
      {blockChoices.map(({ level, label, icon }) => (
        <FormatButton key={level} label={label} active={!isQuote && block === level} onActivate={() => setBlock(level)}>
          {icon}
        </FormatButton>
      ))}
      <FormatButton label="Quote" active={isQuote} onActivate={() => run((ctx) => {
        setBlockStyle(ctx, isQuote ? 'text' : 'quote')
        ctx.get(editorViewCtx).focus()
      })}>
        <Quote size={16} aria-hidden="true" />
      </FormatButton>
      <span className="notes-formatting-divider" role="separator" aria-orientation="vertical" />
      {textStyleMenus.map(({ kind, label, defaultLabel }) => (
        <select
          key={kind}
          className="app-dropdown notes-text-style-select"
          aria-label={label}
          title={label}
          value={textStyleAt(state, kind) ?? ''}
          onChange={(event) => chooseTextStyle(kind, event.target.value)}
        >
          <option value="">{defaultLabel}</option>
          {textStyleChoices[kind].map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.label}</option>
          ))}
        </select>
      ))}
      <span className="notes-formatting-divider" role="separator" aria-orientation="vertical" />
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
      <span className="notes-formatting-divider" role="separator" aria-orientation="vertical" />
      {/* Icons alone: these three are familiar enough to spare the room, and
          each still says what it is when pointed at. */}
      <FormatButton label="Cut" active={false} disabled={state.selection.empty} onActivate={() => editClipboard('cut')}>
        <Scissors size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Copy" active={false} disabled={state.selection.empty} onActivate={() => editClipboard('copy')}>
        <Copy size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Paste" active={false} onActivate={() => { void paste(false) }}>
        <ClipboardPaste size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Paste as plain text" active={false} worded onActivate={() => { void paste(true) }}>
        Paste as text
      </FormatButton>
      {clipboardError && <span className="notes-clipboard-error" role="status">{clipboardError}</span>}
      <span className="notes-formatting-divider" role="separator" aria-orientation="vertical" />
      <span className={`word-graph-invoke-container${wordSelection ? '' : ' is-disabled'}`} title={wordSelection ? undefined : 'Select a word'}>
        <button type="button" className="notes-formatting-button word-graph-invoke" disabled={!wordSelection}
          aria-describedby={wordSelection ? undefined : 'word-graph-select-word-hint'}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            const captured = captureWordSelection(viewRef.current.state)
            if (!captured) return
            const anchor = viewRef.current.coordsAtPos(viewRef.current.state.selection.from)
            isOpen.current = false
            provider.current?.hide()
            openWordGraph({ ...captured, anchor: { x: anchor.left + 24, y: anchor.bottom + 12 }, returnFocus: viewRef.current.dom })
          }}>Word graph</button>
        <span id="word-graph-select-word-hint" className="sr-only">Select a word</span>
      </span>
    </div>
  )
}

/**
 * What a line can be. Level 0 is ordinary writing; the rest are the three
 * heading sizes the insert menu offers, so the two routes agree.
 */
const blockChoices = [
  { level: 0, label: 'Text', icon: <Pilcrow size={16} aria-hidden="true" /> },
  { level: 1, label: 'Heading', icon: <Heading1 size={16} aria-hidden="true" /> },
  { level: 2, label: 'Subheading', icon: <Heading2 size={16} aria-hidden="true" /> },
  { level: 3, label: 'Small heading', icon: <Heading3 size={16} aria-hidden="true" /> },
]

/** Says what each menu is about when it is showing its default, as all three start. */
const textStyleMenus: Array<{ kind: TextStyleKind; label: string; defaultLabel: string }> = [
  { kind: 'font', label: 'Font', defaultLabel: 'Default font' },
  { kind: 'size', label: 'Text size', defaultLabel: 'Default size' },
  { kind: 'color', label: 'Text colour', defaultLabel: 'Default colour' },
]

/**
 * What the line holding the caret is: 0 for a paragraph, the level for a
 * heading, and -1 for anything else (a list item, a quote, an embed), where
 * no block button should read as active.
 */
function blockOf(state: EditorState) {
  const parent = state.selection.$from.parent
  if (parent.type.name === 'paragraph') return 0
  if (parent.type.name === 'heading') return parent.attrs.level as number
  return -1
}

/**
 * The press is swallowed so the editor keeps focus and the selection the
 * command is about to act on; the click that follows is what acts.
 */
export function FormatButton({ label, active, disabled, worded, onActivate, children }: {
  label: string
  active: boolean
  /** For a tool with nothing to act on right now -- Link, on a bare caret. */
  disabled?: boolean
  worded?: boolean
  onActivate: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`notes-formatting-button${active ? ' is-active' : ''}${worded ? ' is-worded' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      onClick={onActivate}
    >
      {children}
    </button>
  )
}

/** Whether every character of the selection carries the mark (or, for a caret, whether typing would). */
export function isMarkActive(state: EditorState, type: MarkType | undefined) {
  if (!type) return false
  const { from, $from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}
