import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Heading1, Heading2, Heading3, Image as ImageIcon, List, ListOrdered, Minus, Quote } from 'lucide-react'
import type { Ctx } from '@milkdown/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/core'
import { slashFactory, SlashProvider } from '@milkdown/plugin-slash'
import {
  insertHrCommand,
  insertImageCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark'
import type { EditorView } from '@milkdown/prose/view'
import { usePluginViewContext } from '@prosemirror-adapter/react'
import { useAppState } from '../AppState'
import type { ImageItem } from '../types'
import { useNotesEditorActions } from './notesEditorActions'

/**
 * The insert menu: type `/` at the start of a line or after a space and a
 * short list of things to insert appears under the caret; keep typing to
 * narrow it, arrow keys to move, Enter to choose, Escape to dismiss. It is
 * the one route to structure that is not a Markdown shortcut, so it is
 * what a writer who has never seen Markdown will use.
 *
 * Milkdown's slash plugin supplies the trigger detection and the position
 * (floating-ui, below the caret); everything a person sees or presses is
 * here. Like the formatting bar it lives on `document.body`, outside the
 * panel's clipping box and tldraw's scaled layer.
 */
export const insertMenu = slashFactory('notesInsert')

interface InsertItem {
  id: string
  label: string
  /** Extra words the filter matches, for the names people reach for. */
  keywords: string
  icon: JSX.Element
  /** Why the item cannot be chosen right now, when it cannot. */
  disabled?: string
  run: (ctx: Ctx) => void
}

/** The `/` and what follows it, when the caret sits at the end of one. */
const triggerPattern = /(?:^|\s)\/([\w ]{0,30})$/

export function NotesInsertMenu() {
  const ref = useRef<HTMLDivElement>(null)
  const provider = useRef<SlashProvider>()
  const { view, prevState } = usePluginViewContext()
  const viewRef = useRef(view)
  viewRef.current = view
  const { run, addKeyHandler } = useNotesEditorActions()
  const { panels, slideshow } = useAppState()
  const [activeIndex, setActiveIndex] = useState(0)
  // The query the writer pressed Escape on: the menu stays away until the
  // text after the slash changes.
  const dismissed = useRef<string | null>(null)

  const query = queryOf(view)
  const image = currentPictureOf(panels.all.filter((panel) => panel.type === 'slideshow').map((panel) => panel.id), slideshow)
  const items = query === null ? [] : filterItems(buildItems(image), query)
  const isOpen = query !== null && items.length > 0 && dismissed.current !== query
  const active = Math.min(activeIndex, Math.max(items.length - 1, 0))

  // Refs let the provider's shouldShow and the key handler, both created
  // once, read the render-time values.
  const openRef = useRef(isOpen)
  openRef.current = isOpen
  const itemsRef = useRef(items)
  itemsRef.current = items
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const element = ref.current
    if (!element) return
    provider.current = new SlashProvider({
      content: element,
      root: document.body,
      debounce: 0,
      shouldShow: () => openRef.current,
      offset: 6,
    })
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

  useEffect(() => {
    provider.current?.update(view, prevState)
  })

  // A new query starts the highlight from the top again, and once the
  // caret has left the slash altogether an earlier Escape is forgotten.
  useEffect(() => {
    setActiveIndex(0)
    if (query === null) dismissed.current = null
  }, [query])

  // Read through the view rather than the render-time `query`: the key
  // handler that calls this was registered once and would see a stale one.
  function choose(item: InsertItem) {
    const typed = queryOf(viewRef.current)
    if (item.disabled || typed === null) return
    provider.current?.hide()
    run((ctx) => {
      const editorView = ctx.get(editorViewCtx)
      const { from } = editorView.state.selection
      // Remove the slash and what was typed after it, then insert into
      // the now-empty spot.
      editorView.dispatch(editorView.state.tr.delete(from - typed.length - 1, from))
      item.run(ctx)
      editorView.focus()
    })
  }

  useEffect(() => addKeyHandler((event) => {
    if (!openRef.current) return false
    const list = itemsRef.current
    switch (event.key) {
      case 'ArrowDown':
        setActiveIndex((index) => (index + 1) % list.length)
        return true
      case 'ArrowUp':
        setActiveIndex((index) => (index - 1 + list.length) % list.length)
        return true
      case 'Enter': {
        const item = list[activeRef.current]
        if (item) choose(item)
        return true
      }
      case 'Escape':
        // Claimed here and stopped here: tldraw's document-level Escape
        // handler would otherwise cancel and pull focus onto the canvas.
        // With no menu open that is the right thing (Escape leaves the
        // document for the canvas); with one open, Escape closes the menu.
        event.stopPropagation()
        dismissed.current = queryOf(viewRef.current)
        provider.current?.hide()
        return true
      default:
        return false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [addKeyHandler])

  return (
    <div ref={ref} className="notes-insert-menu" role="listbox" aria-label="Insert" data-show="false">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          className={`notes-insert-item${index === active ? ' is-active' : ''}`}
          aria-selected={index === active}
          aria-disabled={item.disabled ? true : undefined}
          title={item.disabled}
          // Movement, not entry: the menu opens under wherever the pointer
          // happens to rest, and that must not steal the highlight from
          // the first item.
          onMouseMove={() => { if (index !== active) setActiveIndex(index) }}
          onMouseDown={(event: MouseEvent) => { event.preventDefault(); choose(item) }}
        >
          <span className="notes-insert-icon" aria-hidden="true">{item.icon}</span>
          <span className="notes-insert-label">{item.label}</span>
          {item.disabled ? <span className="notes-insert-hint">{item.disabled}</span> : null}
        </button>
      ))}
    </div>
  )
}

function queryOf(view: EditorView): string | null {
  const { selection } = view.state
  const { $from, empty } = selection
  if (!empty || !$from.parent.isTextblock || $from.parent.type.name !== 'paragraph') return null
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC')
  const match = triggerPattern.exec(before)
  return match ? match[1] : null
}

function filterItems(items: InsertItem[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(needle))
}

function buildItems(image: ImageItem | null): InsertItem[] {
  return [
    { id: 'h1', label: 'Heading', keywords: 'title h1 large', icon: <Heading1 size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 1) },
    { id: 'h2', label: 'Subheading', keywords: 'heading h2 section', icon: <Heading2 size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 2) },
    { id: 'h3', label: 'Small heading', keywords: 'heading h3', icon: <Heading3 size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 3) },
    { id: 'quote', label: 'Quote', keywords: 'blockquote citation', icon: <Quote size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key) },
    { id: 'bullets', label: 'Bulleted list', keywords: 'list bullets unordered', icon: <List size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInBulletListCommand.key) },
    { id: 'numbers', label: 'Numbered list', keywords: 'list numbers ordered', icon: <ListOrdered size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInOrderedListCommand.key) },
    { id: 'divider', label: 'Divider', keywords: 'rule line break section hr', icon: <Minus size={16} />, run: (ctx) => ctx.get(commandsCtx).call(insertHrCommand.key) },
    {
      id: 'image',
      label: 'Picture from the Images panel',
      keywords: 'image photo picture',
      icon: <ImageIcon size={16} />,
      // A folder picture is an object URL that dies with the page; until
      // notes can hold a stable reference to a local image, only pictures
      // with a lasting address (the sample collections) can be placed.
      disabled: !image ? 'No picture is showing' : image.urlKind !== 'static' ? 'Sample collections only, for now' : undefined,
      run: (ctx) => { if (image) ctx.get(commandsCtx).call(insertImageCommand.key, { src: image.url, alt: image.name, title: '' }) },
    },
  ]
}

/** The picture the first Images panel that has any is showing right now. */
function currentPictureOf(panelIds: string[], slideshow: ReturnType<typeof useAppState>['slideshow']): ImageItem | null {
  for (const panelId of panelIds) {
    const images = slideshow.imagesFor(panelId)
    if (images.length === 0) continue
    return images[slideshow.currentIndexFor(panelId)] ?? images[0]
  }
  return null
}
