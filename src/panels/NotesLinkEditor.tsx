import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, Unlink } from 'lucide-react'
import { commandsCtx, editorViewCtx } from '@milkdown/core'
import { linkSchema, toggleLinkCommand, updateLinkCommand } from '@milkdown/preset-commonmark'
import { tooltipFactory, TooltipProvider } from '@milkdown/plugin-tooltip'
import type { Node as ProseNode } from '@milkdown/prose/model'
import type { EditorState } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { $command } from '@milkdown/utils'
import { usePluginViewContext } from '@prosemirror-adapter/react'
import { markPointerEventHandled } from '../panelSurface'
import { useNotesEditorActions } from './notesEditorActions'

/**
 * A link's address, asked for with a real field instead of `window.prompt`.
 *
 * A native prompt is unthemed and modal -- it sits outside the app's own
 * chrome, which is exactly the seam the rest of this editor has been closed
 * -- and it offers no way to see or change a link once it exists, only to
 * remove it and start over. This is a small floating field instead, in the
 * same family as the formatting bar and the insert menu: asked for by the
 * Link button on either toolbar, or by `Ctrl-K`/`Cmd-K`, the convention
 * most editors that have a link feature use for it.
 *
 * It has two shapes. Placed on a plain selection it creates a link over
 * those words, field empty. Placed on or inside an existing one -- a
 * selection touching it, or just the caret resting in it, which is the more
 * common case -- it edits that link's address, field already filled in,
 * with a way to remove it entirely. Which of the two it is is decided once,
 * when it opens; nothing else needs to know.
 */
export const linkEditorTooltip = tooltipFactory('notesLinkEditor')

interface LinkEditorState {
  mode: 'create' | 'edit'
  href: string
}

export function NotesLinkEditor() {
  const ref = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const provider = useRef<TooltipProvider>()
  const { view, prevState } = usePluginViewContext()
  const viewRef = useRef(view)
  viewRef.current = view
  const { run, addKeyHandler, registerLinkEditorOpener } = useNotesEditorActions()
  // Whether the popover is asked for, and what it is asking about -- a ref
  // for the provider's shouldShow, made once, to read; state for the field,
  // which has to re-render as it is typed in.
  const isOpenRef = useRef(false)
  const [editing, setEditing] = useState<LinkEditorState | null>(null)
  // Controlled, not defaultValue: the input is mounted once and never
  // remounted (its container has to stay put for the tooltip provider), so
  // a second open -- of a different link, or the same one again -- would
  // otherwise still be showing whatever was last typed into it.
  const [value, setValue] = useState('')

  useEffect(() => {
    const element = ref.current
    if (!element) return
    provider.current = new TooltipProvider({
      content: element,
      root: document.body,
      debounce: 0,
      offset: 8,
      shouldShow: () => isOpenRef.current,
    })
    const close = () => {
      if (!isOpenRef.current) return
      isOpenRef.current = false
      provider.current?.hide()
    }
    // A wheel moves the canvas under a field anchored to a point on it, the
    // same reason the formatting bar closes on one rather than following.
    const onWheel = () => close()
    const onPointerDown = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close()
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('pointerdown', onPointerDown, true)
      provider.current?.destroy()
    }
  }, [])

  useEffect(() => {
    provider.current?.update(view, prevState)
  })

  /**
   * Looks at the selection to decide what opening means, then shows the
   * field there. Read through `viewRef` rather than the render-time `view`:
   * this is handed out through `registerLinkEditorOpener` to components
   * that are not this one, and could be called long after this render.
   */
  function open() {
    const currentView = viewRef.current
    const existing = linkRangeAt(currentView.state)
    let anchor: { from: number; to: number }
    let next: LinkEditorState
    if (existing) {
      anchor = existing
      next = { mode: 'edit', href: existing.href }
    } else if (!currentView.state.selection.empty) {
      anchor = { from: currentView.state.selection.from, to: currentView.state.selection.to }
      next = { mode: 'create', href: '' }
    } else {
      // Nothing to create a link from and no link to edit. The buttons that
      // call this stay disabled in exactly this case, so this is reached
      // only through the keyboard shortcut.
      return
    }
    setEditing(next)
    setValue(next.href)
    isOpenRef.current = true
    provider.current?.show({
      getBoundingClientRect: () => posToDOMRect(currentView, anchor.from, anchor.to),
    }, currentView)
    // The popover is still display:none in this same tick -- the show()
    // call above is what changes that -- so focus has to wait one frame for
    // the browser to have somewhere to put it.
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  useEffect(() => registerLinkEditorOpener(open), [registerLinkEditorOpener])

  useEffect(() => addKeyHandler((event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return false
    event.preventDefault()
    open()
    return true
  }), [addKeyHandler])

  function close() {
    isOpenRef.current = false
    provider.current?.hide()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    const href = linkAddress(value)
    run((ctx) => {
      const commands = ctx.get(commandsCtx)
      if (!href) {
        // An edit cleared to nothing removes the link; a create left empty
        // has nothing to create, so this is simply abandoned.
        if (editing.mode === 'edit') commands.call(removeLinkCommand.key)
      } else if (editing.mode === 'edit') {
        commands.call(updateLinkCommand.key, { href })
      } else {
        commands.call(toggleLinkCommand.key, { href })
      }
      ctx.get(editorViewCtx).focus()
    })
    close()
  }

  function remove() {
    run((ctx) => {
      ctx.get(commandsCtx).call(removeLinkCommand.key)
      ctx.get(editorViewCtx).focus()
    })
    close()
  }

  function handleInputKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    // Claimed and stopped here rather than left to bubble: this field lives
    // on the body, outside the editor, so nothing else would otherwise hear
    // it -- except tldraw's own document-level Escape handler, which would
    // deselect whatever is selected on the canvas.
    event.preventDefault()
    event.stopPropagation()
    close()
    run((ctx) => ctx.get(editorViewCtx).focus())
  }

  return (
    <form
      ref={ref}
      className="notes-link-editor"
      role="group"
      aria-label="Link"
      data-show="false"
      onPointerDown={markPointerEventHandled}
      onSubmit={submit}
    >
      <input
        ref={inputRef}
        className="notes-link-editor-input"
        type="text"
        inputMode="url"
        placeholder="example.com"
        aria-label="Link address"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleInputKeyDown}
      />
      <button type="submit" className="notes-formatting-button" title="Save" aria-label="Save link">
        <Check size={16} aria-hidden="true" />
      </button>
      {editing?.mode === 'edit' ? (
        <button type="button" className="notes-formatting-button is-destructive" title="Remove link" aria-label="Remove link" onClick={remove}>
          <Unlink size={16} aria-hidden="true" />
        </button>
      ) : null}
    </form>
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

/**
 * The link mark touching the current selection, and the range it covers --
 * the same node the caret is standing in when there is no selection at all,
 * which is the ordinary way a writer arrives at "edit this link". Matches
 * `updateLinkCommand`'s own reach exactly (including its one limitation: a
 * link split across marks by other formatting inside it is read and edited
 * as only its first run), since editing has to find what that command will
 * actually change.
 */
function linkRangeAt(state: EditorState): { href: string; from: number; to: number } | null {
  const linkType = state.schema.marks.link
  if (!linkType) return null
  const { from, to } = state.selection
  const matches: { href: string; from: number; to: number }[] = []
  state.doc.nodesBetween(from, from === to ? to + 1 : to, (node, pos) => {
    if (matches.length) return false
    const mark = node.marks.find((candidate) => candidate.type === linkType)
    if (!mark) return undefined
    matches.push({ href: mark.attrs.href as string, from: pos, to: pos + node.nodeSize })
    return false
  })
  return matches[0] ?? null
}

/** Whether the Link tool has anything to do at the current selection. */
export function canEditLink(state: EditorState) {
  return linkRangeAt(state) !== null || !state.selection.empty
}

/** Whether the caret is on or inside a link right now, for the button's own state. */
export function isOnLink(state: EditorState) {
  return linkRangeAt(state) !== null
}

/**
 * Removes the link mark from its full range -- the same range
 * `updateLinkCommand` finds, so what "editing this link" reaches is what
 * "removing this link" reaches too. `toggleLinkCommand` cannot do this on
 * its own from a collapsed caret: ProseMirror's `toggleMark` treats an
 * empty selection as changing what is typed *next*, not the mark already on
 * the surrounding text, so a click inside a link with nothing selected
 * would look like removal and remove nothing.
 */
export const removeLinkCommand = $command('RemoveLink', (ctx) => () => (state, dispatch) => {
  const linkType = linkSchema.type(ctx)
  const { from, to } = state.selection
  // A one-slot array rather than a reassigned variable: TypeScript stops
  // narrowing a variable's null-ness past a guard once it has been written
  // to from inside a closure (the `nodesBetween` callback), and reading an
  // array populated by `push` sidesteps that rather than fighting it.
  const matches: { pos: number; node: ProseNode }[] = []
  state.doc.nodesBetween(from, from === to ? to + 1 : to, (node, pos) => {
    if (matches.length) return false
    if (linkType.isInSet(node.marks)) matches.push({ node, pos })
    return undefined
  })
  const found = matches[0]
  if (!found) return false
  const mark = found.node.marks.find((candidate) => candidate.type === linkType)
  if (!mark) return false
  if (dispatch) dispatch(state.tr.removeMark(found.pos, found.pos + found.node.nodeSize, mark).scrollIntoView())
  return true
})

/**
 * The screen rectangle a selection occupies, for floating-ui to anchor the
 * popover to -- the same technique Milkdown's own tooltip uses internally,
 * rebuilt here because it is not part of the package's public surface.
 */
function posToDOMRect(view: EditorView, from: number, to: number): DOMRect {
  const start = view.coordsAtPos(from)
  const end = view.coordsAtPos(to, -1)
  const top = Math.min(start.top, end.top)
  const bottom = Math.max(start.bottom, end.bottom)
  const left = Math.min(start.left, end.left)
  const right = Math.max(start.right, end.right)
  const width = right - left
  const height = bottom - top
  return {
    top, bottom, left, right, width, height, x: left, y: top,
    toJSON: () => ({ top, bottom, left, right, width, height, x: left, y: top }),
  }
}
