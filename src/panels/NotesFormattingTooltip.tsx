import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Bold, Code, Heading1, Heading2, Heading3, Italic, Link as LinkIcon, Pilcrow, Underline as UnderlineIcon } from 'lucide-react'
import { commandsCtx, editorViewCtx } from '@milkdown/core'
import { tooltipFactory, TooltipProvider } from '@milkdown/plugin-tooltip'
import {
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInHeadingCommand,
} from '@milkdown/preset-commonmark'
import type { EditorState } from '@milkdown/prose/state'
import type { MarkType } from '@milkdown/prose/model'
import { usePluginViewContext } from '@prosemirror-adapter/react'
import { markPointerEventHandled } from '../panelSurface'
import { useNotesEditorActions } from './notesEditorActions'
import { toggleUnderlineCommand } from './notesUnderline'

/**
 * The contextual formatting bar: what a line is, and the few marks a writer
 * reaches for mid-sentence, asked for by right-clicking rather than offered
 * on every selection. Selecting a phrase to re-read it, or dragging through a line
 * to delete it, should not put a row of buttons over the words -- so the
 * bar waits to be called, the way Typora's does.
 *
 * The cost is the browser's own menu inside the note: a right-click that
 * opens this cannot also open that. Cut, copy and paste keep their
 * keyboard shortcuts, which is where most writers reach for them anyway.
 *
 * Milkdown's tooltip plugin still does the positioning (floating-ui, above
 * the point, flipping below when there is no room); what it no longer does
 * is decide when to show, which is this component's `open` flag.
 *
 * It is mounted on `document.body`, not inside the panel. The panel body
 * clips its overflow, so a bar anchored to the first line would otherwise
 * be pushed below the selection or cut off; and outside tldraw's scaled
 * layer the bar keeps the same size as the rest of the app's chrome
 * whatever the canvas zoom.
 */
export const formattingTooltip = tooltipFactory('notesFormatting')

export function NotesFormattingTooltip() {
  const ref = useRef<HTMLDivElement>(null)
  const provider = useRef<TooltipProvider>()
  const { view, prevState } = usePluginViewContext()
  const viewRef = useRef(view)
  viewRef.current = view
  const { run } = useNotesEditorActions()
  // Where the writer asked for the bar, and whether they have asked at all.
  // A ref rather than state: the provider's shouldShow, made once, reads it.
  const openAt = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    provider.current = new TooltipProvider({
      content: element,
      root: document.body,
      debounce: 0,
      offset: 8,
      // The bar is asked for, never offered: an update only keeps it up
      // while the request stands.
      shouldShow: () => openAt.current !== null,
    })
    // A wheel over the canvas pans or zooms it under a bar anchored to the
    // old place. Hide while the wheel turns, then put the bar back where
    // the selection now is. The re-show has to be asked for: the selection
    // itself has not changed, so the editor dispatches nothing that would
    // otherwise prompt the provider to look again.
    const close = () => {
      if (!openAt.current) return
      openAt.current = null
      provider.current?.hide()
    }
    // A wheel moves the canvas under a bar anchored to a point on it, and a
    // press anywhere else is the writer moving on: either way the request
    // has lapsed.
    const onWheel = () => close()
    const onPointerDown = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close()
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('pointerdown', onPointerDown, true)

    // The request itself. The browser's menu is given up here, which is the
    // trade this makes.
    const editorDom = viewRef.current.dom
    const onContextMenu = (event: Event) => {
      const mouse = event as globalThis.MouseEvent
      event.preventDefault()
      event.stopPropagation()
      openAt.current = { x: mouse.clientX, y: mouse.clientY }
      const point = openAt.current
      provider.current?.show({
        getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0),
      }, viewRef.current)
    }
    editorDom.addEventListener('contextmenu', onContextMenu)

    return () => {
      editorDom.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('pointerdown', onPointerDown, true)
      provider.current?.destroy()
    }
  }, [])

  // The adapter re-renders after every editor transaction. An edit answers
  // the request the bar was opened for, so it closes; a bare selection
  // change leaves it alone, since the writer may be choosing what to format.
  useEffect(() => {
    if (openAt.current && prevState && !prevState.doc.eq(view.state.doc)) {
      openAt.current = null
      provider.current?.hide()
      return
    }
    provider.current?.update(view, prevState)
  })

  const { state } = view
  const marks = state.schema.marks
  const block = blockOf(state)

  function setBlock(level: number) {
    run((ctx) => {
      const commands = ctx.get(commandsCtx)
      // Level 0 is the way back: a heading turned into ordinary writing.
      if (level === 0) commands.call(turnIntoTextCommand.key)
      else commands.call(wrapInHeadingCommand.key, level)
      ctx.get(editorViewCtx).focus()
    })
  }

  function toggleLink() {
    if (isMarkActive(state, marks.link)) {
      run((ctx) => ctx.get(commandsCtx).call(toggleLinkCommand.key))
      return
    }
    // A stand-in for a link editor. It has to run from the click rather
    // than the press: a modal opened during mousedown never lets the
    // matching mouseup reach the page, and the browser goes on believing
    // the button is held -- which reads as a stuck button and a drag that
    // will not let go.
    const typed = window.prompt('Link address')
    const href = typed ? linkAddress(typed) : ''
    run((ctx) => {
      ctx.get(editorViewCtx).focus()
      if (href) ctx.get(commandsCtx).call(toggleLinkCommand.key, { href })
    })
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    openAt.current = null
    provider.current?.hide()
    run((ctx) => ctx.get(editorViewCtx).focus())
  }

  return (
    <div ref={ref} className="notes-formatting-tooltip" role="toolbar" aria-label="Formatting" data-show="false" onKeyDown={handleKeyDown} onPointerDown={markPointerEventHandled}>
      {blockChoices.map(({ level, label, icon }) => (
        <FormatButton key={level} label={label} active={block === level} onActivate={() => setBlock(level)}>
          {icon}
        </FormatButton>
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
      <FormatButton label="Code" active={isMarkActive(state, marks.inlineCode)} onActivate={() => run((ctx) => ctx.get(commandsCtx).call(toggleInlineCodeCommand.key))}>
        <Code size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Link" active={isMarkActive(state, marks.link)} onActivate={toggleLink}>
        <LinkIcon size={16} aria-hidden="true" />
      </FormatButton>
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
function FormatButton({ label, active, onActivate, children }: {
  label: string
  active: boolean
  onActivate: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`notes-formatting-button${active ? ' is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      onClick={onActivate}
    >
      {children}
    </button>
  )
}

/**
 * What a writer types is a place, not a URL: `example.com` or an email
 * address, rarely `https://example.com`. Without a scheme the browser reads
 * it as a path on this app and the link goes nowhere, so one is supplied.
 */
export function linkAddress(typed: string) {
  const trimmed = typed.trim()
  if (!trimmed) return ''
  // Already addressed: a scheme, a path, or an anchor on this page.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`
  return `https://${trimmed}`
}

/** Whether every character of the selection carries the mark (or, for a caret, whether typing would). */
function isMarkActive(state: EditorState, type: MarkType | undefined) {
  if (!type) return false
  const { from, $from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}
