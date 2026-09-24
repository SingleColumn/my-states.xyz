import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Editor, EditorStatus, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/core'
import { commonmark, imageSchema, linkAttr } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { history } from '@milkdown/plugin-history'
import { clipboard } from '@milkdown/plugin-clipboard'
import { Plugin, PluginKey, Selection } from '@milkdown/prose/state'
import type { Node as ProseNode } from '@milkdown/prose/model'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose, $view, getMarkdown } from '@milkdown/utils'
import { ProsemirrorAdapterProvider, useNodeViewFactory, usePluginViewFactory } from '@prosemirror-adapter/react'
import type { NoteDocument } from '../types'
import { NotesEditorActionsContext, type NotesEditorActions } from './notesEditorActions'
import { formattingTooltip, NotesFormattingTooltip } from './NotesFormattingTooltip'
import { linkEditorTooltip, NotesLinkEditor, removeLinkCommand } from './NotesLinkEditor'
import { insertMenu, NotesInsertMenu } from './NotesInsertMenu'
import { panelEmbed, panelEmbedDrop, panelEmbedDropCursor, panelEmbedRemark, PanelEmbedView } from './notesEmbed'
import { configureUnderlineStringify, toggleUnderlineCommand, underlineKeymap, underlineRemark, underlineSchema } from './notesUnderline'
import { configureHighlightStringify, highlightInputRule, highlightKeymap, highlightRemark, highlightSchema, toggleHighlightCommand } from './notesHighlight'
import { NotesWritingToolbar } from './NotesWritingToolbar'
import { configureImageSize, imageSizeRemark, NotesImageView } from './notesImage'
import '@milkdown/prose/view/style/prosemirror.css'

/**
 * The writing surface: Milkdown (ProseMirror + remark) mounted by hand into
 * a ref. The note goes in once, when the editor is created -- as its
 * structured document when the note has one, as Markdown otherwise -- and
 * every edit comes back out through `onChange` as the document, which is
 * what the store keeps. Its Markdown, which the exports and bundles need,
 * is derived through the handle given to `onHandle`, only when something
 * asks for it.
 *
 * The parent keys this component on the note id, so a change of note is a
 * fresh mount rather than a value swap; that keeps the caret and the undo
 * history for the note being left from leaking into the one being opened.
 *
 * The adapter provider is what lets floating UI (the formatting tooltip)
 * be a React component while ProseMirror owns its lifecycle. It renders
 * those components itself, as portals from its own position in the tree,
 * so anything they must read through React context has to be provided
 * *above* it -- hence the actions live here and not in the inner component
 * that creates the editor.
 */
export function NotesEditor(props: NotesEditorProps) {
  const editorRef = useRef<Editor>()
  const keyHandlers = useRef(new Set<(event: KeyboardEvent) => boolean>())
  const emojiOpeners = useRef(new Set<() => void>())
  const linkEditorOpeners = useRef(new Set<() => void>())
  const actions = useMemo<NotesEditorActions>(() => ({
    run: (action) => { editorRef.current?.action(action) },
    addKeyHandler: (handler) => {
      keyHandlers.current.add(handler)
      return () => { keyHandlers.current.delete(handler) }
    },
    openEmojiList: () => { for (const open of emojiOpeners.current) open() },
    registerEmojiOpener: (open: () => void) => {
      emojiOpeners.current.add(open)
      return () => { emojiOpeners.current.delete(open) }
    },
    openLinkEditor: () => { for (const open of linkEditorOpeners.current) open() },
    registerLinkEditorOpener: (open: () => void) => {
      linkEditorOpeners.current.add(open)
      return () => { linkEditorOpeners.current.delete(open) }
    },
  }), [])
  return (
    <NotesEditorActionsContext.Provider value={actions}>
      <ProsemirrorAdapterProvider>
        <NotesEditorInner {...props} editorRef={editorRef} keyHandlers={keyHandlers} />
      </ProsemirrorAdapterProvider>
    </NotesEditorActionsContext.Provider>
  )
}

interface NotesEditorProps {
  markdown: string
  document: NoteDocument | undefined
  placeholder: string
  /**
   * Where the writing tools are drawn. The panel owns the element so the
   * toolbar can sit above the note's title rather than inside the text, and
   * the editor fills it with a plugin view so it re-reads the document on
   * every keystroke.
   */
  toolbarHost: MutableRefObject<HTMLElement | null>
  /** Every edit: the document as it now stands, and what the footer counts. */
  onChange: (document: NoteDocument, stats: NoteStats) => void
  /**
   * The editor, once it is ready, for the few things the panel around it
   * has to ask of it. Called with null as the editor goes, which is also
   * the store's cue to take its Markdown one last time.
   */
  onHandle: (handle: NotesEditorHandle | null) => void
}

export interface NotesEditorHandle {
  /** The note as Markdown, derived now. */
  getMarkdown(): string
  /** Puts the caret at the start of the document -- where the title leads. */
  focusStart(): void
}

/** What the panel's footer reports, counted from the document, not its Markdown. */
export interface NoteStats {
  characters: number
  words: number
}

/**
 * The version written into every stored document. Bump it when the editor
 * schema can no longer read documents written before the change; older
 * documents are then read from their Markdown instead.
 */
export const NOTE_DOCUMENT_SCHEMA_VERSION = 1

/**
 * A stored document is preferred over the Markdown unless this local flag
 * turns it off -- a way to check what the Markdown alone gives back, since
 * that is what a moment bundle carries.
 */
function prefersMarkdown() {
  try {
    return window.localStorage.getItem('mic:notes-load-from-markdown') === 'true'
  } catch {
    return false
  }
}

function NotesEditorInner({ markdown, document: noteDocument, placeholder, toolbarHost, onChange, onHandle, editorRef, keyHandlers }: NotesEditorProps & {
  editorRef: MutableRefObject<Editor | undefined>
  keyHandlers: MutableRefObject<Set<(event: KeyboardEvent) => boolean>>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const pluginViewFactory = usePluginViewFactory()
  const nodeViewFactory = useNodeViewFactory()
  // The callback is read through a ref so a new closure from the parent
  // does not recreate the editor (which would drop the caret mid-sentence).
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const handleRef = useRef(onHandle)
  handleRef.current = onHandle

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Milkdown mounts into the element it is given and takes it apart again
    // on destroy, which is asynchronous. React can start the next effect --
    // StrictMode does it on every mount -- before that teardown finishes, so
    // a shared host would end up with two editors in it. Each editor gets
    // its own mount element instead, removed synchronously on cleanup.
    const mount = document.createElement('div')
    mount.className = 'notes-editor-mount'
    host.appendChild(mount)

    const storedDocument = noteDocument && noteDocument.schemaVersion === NOTE_DOCUMENT_SCHEMA_VERSION && !prefersMarkdown() ? noteDocument.doc : null
    const make = (fromDocument: boolean) => Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, mount)
        ctx.set(defaultValueCtx, fromDocument && storedDocument ? { type: 'json', value: storedDocument as never } : markdown)
        // The class the theme's prose rules already target; ProseMirror puts
        // it on the contenteditable itself, so the writing surface is styled
        // like the previous editor's content area was.
        ctx.set(editorViewOptionsCtx, { attributes: { class: 'notes-editor-content' } })
        // A class, not a title: the mark's own attributes are spread after
        // these and its null title would blank one out.
        ctx.set(linkAttr.key, () => ({ class: 'notes-link' }))
        configureUnderlineStringify(ctx)
        configureHighlightStringify(ctx)
        configureImageSize(ctx)
        // The tooltip is rendered on the body (see NotesFormattingTooltip
        // for why), so its React portal goes there too.
        ctx.set(formattingTooltip.key, {
          view: pluginViewFactory({ component: NotesFormattingTooltip, root: () => document.body }),
        })
        ctx.set(insertMenu.key, {
          view: pluginViewFactory({ component: NotesInsertMenu, root: () => document.body }),
        })
        ctx.set(linkEditorTooltip.key, {
          view: pluginViewFactory({ component: NotesLinkEditor, root: () => document.body }),
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(underlineRemark)
      .use(imageSizeRemark)
      .use($view(imageSchema.node, () => nodeViewFactory({ component: NotesImageView, as: 'span' })))
      .use(underlineSchema)
      .use(toggleUnderlineCommand)
      .use(underlineKeymap)
      .use(highlightRemark)
      .use(highlightSchema)
      .use(toggleHighlightCommand)
      .use(highlightKeymap)
      .use(highlightInputRule)
      .use(changeReporter((doc, stats) => onChangeRef.current({ schemaVersion: NOTE_DOCUMENT_SCHEMA_VERSION, doc: doc.toJSON() as Record<string, unknown> }, stats)))
      .use(placeholderPlugin(placeholder))
      .use(floatingKeys(keyHandlers))
      .use(writingToolbar(pluginViewFactory({ component: NotesWritingToolbar, root: () => toolbarHost.current ?? document.body })))
      .use(linkOpener)
      .use(removeLinkCommand)
      .use(formattingTooltip)
      .use(linkEditorTooltip)
      .use(insertMenu)
      .use(panelEmbedRemark)
      .use(panelEmbed)
      .use($view(panelEmbed, () => nodeViewFactory({ component: PanelEmbedView, as: 'div', contentAs: 'div' })))
      .use(panelEmbedDrop)
      .use(panelEmbedDropCursor)

    const offerHandle = () => {
      const ready = editorRef.current
      if (ready?.status !== EditorStatus.Created) return
      handleRef.current({
        getMarkdown: () => ready.action(getMarkdown()),
        focusStart: () => ready.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)).scrollIntoView())
          view.focus()
        }),
      })
    }
    let editor = make(true)
    editorRef.current = editor
    void editor.create().then(offerHandle).catch(async (error: unknown) => {
      // A stored document the current schema cannot read (a node type gone,
      // an attribute changed) is not the end of the note: the Markdown
      // written beside it is what it looked like, so the note opens from
      // that and the next edit writes a fresh document.
      if (!storedDocument) throw error
      console.warn('The stored note document could not be read; opening it from its Markdown instead.', error)
      await editor.destroy()
      editor = make(false)
      editorRef.current = editor
      await editor.create()
      offerHandle()
    })

    return () => {
      // Withdrawn while the editor can still be asked, so the store can take
      // the Markdown for anything typed since the last save.
      handleRef.current(null)
      editorRef.current = undefined
      void editor.destroy()
      mount.remove()
    }
    // `markdown` is the initial value only; `placeholder` is fixed text; the
    // factory is stable for the life of the adapter provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="notes-rich-editor" />
}

/**
 * Hands every edit to the store in the same tick as the edit.
 *
 * Reporting synchronously rather than on a timer is deliberate: the flush
 * the app runs when the tab is hidden or the page is left can only save what
 * the store has already heard, so anything still sitting in a debounce would
 * be lost. Milkdown's own listener plugin waits 200ms and cancels on
 * destroy, which is exactly that hole.
 *
 * What is reported is cheap to take: about 0.4ms for the document and 0.1ms
 * for the counts on a 20,000-word note. Its Markdown is not -- around 80ms
 * on the same note -- so that is left until something asks for it.
 */
function changeReporter(report: (doc: ProseNode, stats: NoteStats) => void) {
  return $prose(() => new Plugin({
    key: new PluginKey('NOTES_CHANGE_REPORTER'),
    view: () => ({
      update(view, prevState) {
        const { doc } = view.state
        if (prevState.doc.eq(doc)) return
        // Counting the prose rather than the Markdown source also drops the
        // old count's habit of inflating itself with syntax.
        const text = doc.textBetween(0, doc.content.size, NEWLINE, ' ')
        report(doc, { characters: text.length, words: text.match(/\S+/g)?.length ?? 0 })
      },
    }),
  }))
}

const NEWLINE = String.fromCharCode(10)

/**
 * Opens a link when a modifier is held, as editors that are also writing
 * surfaces do: a plain click has to stay free to put the caret inside the
 * link, or its text could never be edited.
 *
 * Holding the modifier also says so, by putting a class on the editor that
 * gives links a pointer cursor -- otherwise the only way to learn that a
 * link can be opened at all is to be told. Shift is included because the
 * browser opens a link on Shift+click whatever we do, and it is better for
 * that to arrive here, where it can be opened without an opener, than to
 * happen behind the editor's back.
 */
const linkOpener = $prose(() => new Plugin({
  key: new PluginKey('NOTES_LINK_OPENER'),
  props: {
    // ProseMirror's own gesture for Ctrl+click (Cmd on a Mac) is to select
    // the node under the pointer, which drew a box around whatever sentence
    // was clicked. Here that modifier means "open the link", so the gesture
    // is claimed and the box never appears. Plain clicks still select an
    // embed, and Shift still extends the selection.
    handleClick(_view, _pos, event) {
      return event.ctrlKey || event.metaKey
    },
    // handleDOMEvents, not handleClick, for the opening itself: ProseMirror
    // routes a Shift+click to extending the selection and never offers it
    // as a click.
    handleDOMEvents: {
      click(view, event) {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return false
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        const link = at && view.state.doc.nodeAt(at.pos)?.marks.find((mark) => mark.type.name === 'link')
        const href = link ? link.attrs.href as string : undefined
        if (!href) return false
        event.preventDefault()
        // No opener and no referrer: the note is the writer's, not the
        // destination's business.
        window.open(href, '_blank', 'noopener,noreferrer')
        return true
      },
    },
  },
  view(view) {
    const armed = (event: KeyboardEvent) => {
      view.dom.classList.toggle('is-link-armed', event.ctrlKey || event.metaKey || event.shiftKey)
    }
    const disarm = () => view.dom.classList.remove('is-link-armed')
    window.addEventListener('keydown', armed)
    window.addEventListener('keyup', armed)
    window.addEventListener('blur', disarm)
    return {
      destroy() {
        window.removeEventListener('keydown', armed)
        window.removeEventListener('keyup', armed)
        window.removeEventListener('blur', disarm)
      },
    }
  },
}))

/**
 * Draws the writing tools into the element the panel set aside for them.
 * A plugin view rather than a component so the toolbar sees every
 * transaction, which is what lets it say what the caret is sitting in.
 */
function writingToolbar(view: NonNullable<Plugin['spec']['view']>) {
  return $prose(() => new Plugin({ key: new PluginKey('NOTES_WRITING_TOOLBAR'), view }))
}

/**
 * Lets floating UI answer a key before the editor's own keymap does. Plugins
 * added with `$prose` sit ahead of Milkdown's keymap in the plugin order,
 * so a handler that claims Enter here keeps it from splitting the paragraph.
 */
function floatingKeys(handlers: MutableRefObject<Set<(event: KeyboardEvent) => boolean>>) {
  return $prose(() => new Plugin({
    key: new PluginKey('NOTES_FLOATING_KEYS'),
    props: {
      handleKeyDown: (_view, event) => {
        for (const handler of handlers.current) {
          if (handler(event)) return true
        }
        return false
      },
    },
  }))
}

/**
 * Shows the hint on an empty note. ProseMirror has no placeholder of its
 * own, so this marks the single empty paragraph with the text and the
 * stylesheet draws it with `::before`; the document itself is untouched.
 */
function placeholderPlugin(text: string) {
  return $prose(() => new Plugin({
    key: new PluginKey('NOTES_PLACEHOLDER'),
    props: {
      decorations(state) {
        const { doc } = state
        const only = doc.childCount === 1 ? doc.firstChild : null
        if (!only || !only.isTextblock || only.content.size > 0) return null
        return DecorationSet.create(doc, [
          Decoration.node(0, only.nodeSize, { class: 'is-empty', 'data-placeholder': text }),
        ])
      },
    },
  }))
}
