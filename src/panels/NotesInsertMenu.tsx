import { useEffect, useRef, useState, type MouseEvent, type MutableRefObject } from 'react'
import { Heading1, Heading2, Heading3, Image as ImageIcon, List, ListOrdered, Minus, Quote, Smile } from 'lucide-react'
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
import { markPointerEventHandled } from '../panelSurface'
import type { ImageItem } from '../types'
import { useNotesEditorActions } from './notesEditorActions'
import { noteEmoji } from './notesEmoji'

/**
 * The insert menu: type `/` at the start of a line or after a space and a
 * short list of things to insert appears under the caret; keep typing to
 * narrow it, arrow keys to move, Enter to choose, Escape to dismiss. It is
 * the one route to structure that is not a Markdown shortcut, so it is
 * what a writer who has never seen Markdown will use.
 *
 * `:` opens the same menu on the emoji list, which is the convention every
 * chat application has taught: `:think` finds the thinking face. It waits
 * for a letter before showing anything, because a colon on its own is
 * ordinary punctuation and a menu over every one would be unusable -- so
 * the `/` menu carries an Emoji entry too, which opens the full list for
 * anyone who has not met the `:` convention.
 *
 * Milkdown's slash plugin supplies the position (floating-ui, below the
 * caret); the triggers and everything a person sees or presses are here.
 * Like the formatting bar it lives on `document.body`, outside the panel's
 * clipping box and tldraw's scaled layer.
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

/** A trigger character and what has been typed after it. */
interface Query {
  trigger: '/' | ':'
  typed: string
}

/** The trigger and what follows it, when the caret sits at the end of one. */
const slashPattern = /(?:^|\s)\/([\w ]{0,30})$/
// No spaces after a colon: `10: ` in ordinary prose must not read as a
// trigger with a query.
const emojiPattern = /(?:^|\s):([\w+-]{0,30})$/

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
  // Set when the emoji list was asked for from the `/` menu rather than by
  // typing `:` and a letter, which is the one case where a bare colon is
  // allowed to open it.
  const browsingEmoji = useRef(false)

  const query = queryOf(view)
  const image = currentPictureOf(panels.all.filter((panel) => panel.type === 'slideshow').map((panel) => panel.id), slideshow)
  const items = query === null ? [] : filterItems(itemsFor(query, image, browsingEmoji), query.typed)
  const isOpen = query !== null && items.length > 0 && dismissed.current !== queryKey(query)
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
  // caret has left the trigger altogether an earlier Escape is forgotten --
  // as is a request to browse the emoji.
  useEffect(() => {
    setActiveIndex(0)
    if (query === null) {
      dismissed.current = null
      browsingEmoji.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query && queryKey(query)])

  // A long list (the emoji) scrolls, so the arrow keys have to bring what
  // they highlight into view.
  useEffect(() => {
    ref.current?.querySelector('.notes-insert-item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Read through the view rather than the render-time `query`: the key
  // handler that calls this was registered once and would see a stale one.
  function choose(item: InsertItem) {
    const asked = queryOf(viewRef.current)
    if (item.disabled || asked === null) return
    provider.current?.hide()
    run((ctx) => {
      const editorView = ctx.get(editorViewCtx)
      const { from } = editorView.state.selection
      // Remove the trigger and what was typed after it, then insert into
      // the now-empty spot.
      editorView.dispatch(editorView.state.tr.delete(from - asked.typed.length - 1, from))
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
        {
          const asked = queryOf(viewRef.current)
          dismissed.current = asked && queryKey(asked)
        }
        browsingEmoji.current = false
        provider.current?.hide()
        return true
      default:
        return false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [addKeyHandler])

  return (
    <div ref={ref} className="notes-insert-menu" role="listbox" aria-label="Insert" data-show="false" onPointerDown={markPointerEventHandled}>
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
          // The press is swallowed so the caret stays where the item is
          // about to act; the click that follows is what acts.
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
          onClick={() => choose(item)}
        >
          <span className="notes-insert-icon" aria-hidden="true">{item.icon}</span>
          <span className="notes-insert-label">{item.label}</span>
          {item.disabled ? <span className="notes-insert-hint">{item.disabled}</span> : null}
        </button>
      ))}
    </div>
  )
}

function queryOf(view: EditorView): Query | null {
  const { selection } = view.state
  const { $from, empty } = selection
  if (!empty || !$from.parent.isTextblock || $from.parent.type.name !== 'paragraph') return null
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC')
  const slash = slashPattern.exec(before)
  if (slash) return { trigger: '/', typed: slash[1] }
  const emoji = emojiPattern.exec(before)
  return emoji ? { trigger: ':', typed: emoji[1] } : null
}

/** One string standing for a query, for the comparisons that need one. */
function queryKey(query: Query) {
  return query.trigger + query.typed
}

function itemsFor(query: Query, image: ImageItem | null, browsingEmoji: MutableRefObject<boolean>): InsertItem[] {
  if (query.trigger === ':') {
    // A colon is punctuation until a letter follows it; the exception is a
    // list asked for by name from the `/` menu.
    return query.typed.length > 0 || browsingEmoji.current ? emojiItems() : []
  }
  return buildItems(image, browsingEmoji)
}

function filterItems(items: InsertItem[], typed: string) {
  const needle = typed.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(needle))
}

function emojiItems(): InsertItem[] {
  return noteEmoji.map((emoji) => ({
    id: `emoji-${emoji.char}`,
    label: emoji.name,
    keywords: emoji.keywords,
    icon: <span className="notes-insert-emoji">{emoji.char}</span>,
    run: (ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText(emoji.char))
    },
  }))
}

function buildItems(image: ImageItem | null, browsingEmoji: MutableRefObject<boolean>): InsertItem[] {
  return [
    { id: 'h1', label: 'Heading', keywords: 'title h1 large', icon: <Heading1 size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 1) },
    { id: 'h2', label: 'Subheading', keywords: 'heading h2 section', icon: <Heading2 size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 2) },
    { id: 'h3', label: 'Small heading', keywords: 'heading h3', icon: <Heading3 size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 3) },
    { id: 'quote', label: 'Quote', keywords: 'blockquote citation', icon: <Quote size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key) },
    { id: 'bullets', label: 'Bulleted list', keywords: 'list bullets unordered', icon: <List size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInBulletListCommand.key) },
    { id: 'numbers', label: 'Numbered list', keywords: 'list numbers ordered', icon: <ListOrdered size={16} />, run: (ctx) => ctx.get(commandsCtx).call(wrapInOrderedListCommand.key) },
    { id: 'divider', label: 'Divider', keywords: 'horizontal rule line break section separator hr', icon: <Minus size={16} />, run: (ctx) => ctx.get(commandsCtx).call(insertHrCommand.key) },
    {
      id: 'emoji',
      label: 'Emoji',
      keywords: 'emoji smiley face symbol icon tick arrow',
      icon: <Smile size={16} />,
      // Types the trigger the emoji list listens for, rather than opening a
      // second kind of menu: what a writer sees is the list they would have
      // got by typing `:` themselves, which teaches the shortcut.
      run: (ctx) => {
        browsingEmoji.current = true
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.insertText(':'))
      },
    },
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
