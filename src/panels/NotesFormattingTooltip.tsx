import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Bold, Code, Italic, Link as LinkIcon } from 'lucide-react'
import { commandsCtx, editorViewCtx } from '@milkdown/core'
import { tooltipFactory, TooltipProvider } from '@milkdown/plugin-tooltip'
import {
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
} from '@milkdown/preset-commonmark'
import type { EditorState } from '@milkdown/prose/state'
import type { MarkType } from '@milkdown/prose/model'
import { usePluginViewContext } from '@prosemirror-adapter/react'
import { useNotesEditorActions } from './notesEditorActions'

/**
 * The contextual formatting bar: appears over a text selection, offers the
 * few marks a writer reaches for mid-sentence, and goes away when the
 * selection does. Milkdown's tooltip plugin decides *when* (a non-empty
 * selection in a focused editor) and *where* (floating-ui, above the
 * selection, flipping below when there is no room); this component is the
 * *what*.
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

  useEffect(() => {
    const element = ref.current
    if (!element) return
    provider.current = new TooltipProvider({
      content: element,
      root: document.body,
      // The plugin's default waits 200ms after every selection change, which
      // reads as the bar lagging the mouse; this is short enough to feel
      // attached to the selection without repositioning on every pixel.
      debounce: 40,
      offset: 8,
    })
    // A wheel over the canvas pans or zooms it under a bar anchored to the
    // old place. Hide while the wheel turns, then put the bar back where
    // the selection now is. The re-show has to be asked for: the selection
    // itself has not changed, so the editor dispatches nothing that would
    // otherwise prompt the provider to look again.
    let settle: number | undefined
    const onWheel = () => {
      provider.current?.hide()
      window.clearTimeout(settle)
      settle = window.setTimeout(() => provider.current?.update(viewRef.current), 150)
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => {
      window.clearTimeout(settle)
      window.removeEventListener('wheel', onWheel, { capture: true })
      provider.current?.destroy()
    }
  }, [])

  // The adapter re-renders this component after every editor transaction,
  // so the bar tracks selection changes here rather than through its own
  // subscription.
  useEffect(() => {
    provider.current?.update(view, prevState)
  })

  const { state } = view
  const marks = state.schema.marks

  function toggle(event: MouseEvent, command: () => void) {
    // Mousedown would move focus out of the editor, which empties the
    // selection the command is about to format.
    event.preventDefault()
    command()
  }

  function toggleLink() {
    if (isMarkActive(state, marks.link)) {
      run((ctx) => ctx.get(commandsCtx).call(toggleLinkCommand.key))
      return
    }
    // A stand-in for a link editor: the prompt takes focus, so the editor
    // is refocused before the mark is applied to the selection it still holds.
    const href = window.prompt('Link address')
    run((ctx) => {
      ctx.get(editorViewCtx).focus()
      if (href) ctx.get(commandsCtx).call(toggleLinkCommand.key, { href })
    })
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    provider.current?.hide()
    run((ctx) => ctx.get(editorViewCtx).focus())
  }

  return (
    <div ref={ref} className="notes-formatting-tooltip" role="toolbar" aria-label="Formatting" data-show="false" onKeyDown={handleKeyDown}>
      <FormatButton label="Bold" active={isMarkActive(state, marks.strong)} onMouseDown={(event) => toggle(event, () => run((ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key)))}>
        <Bold size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Italic" active={isMarkActive(state, marks.emphasis)} onMouseDown={(event) => toggle(event, () => run((ctx) => ctx.get(commandsCtx).call(toggleEmphasisCommand.key)))}>
        <Italic size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Code" active={isMarkActive(state, marks.inlineCode)} onMouseDown={(event) => toggle(event, () => run((ctx) => ctx.get(commandsCtx).call(toggleInlineCodeCommand.key)))}>
        <Code size={16} aria-hidden="true" />
      </FormatButton>
      <FormatButton label="Link" active={isMarkActive(state, marks.link)} onMouseDown={(event) => toggle(event, toggleLink)}>
        <LinkIcon size={16} aria-hidden="true" />
      </FormatButton>
    </div>
  )
}

function FormatButton({ label, active, onMouseDown, children }: {
  label: string
  active: boolean
  onMouseDown: (event: MouseEvent) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`notes-formatting-button${active ? ' is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={onMouseDown}
    >
      {children}
    </button>
  )
}

/** Whether every character of the selection carries the mark (or, for a caret, whether typing would). */
function isMarkActive(state: EditorState, type: MarkType | undefined) {
  if (!type) return false
  const { from, $from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}
