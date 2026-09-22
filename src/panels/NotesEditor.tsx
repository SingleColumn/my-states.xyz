import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx, serializerCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { history } from '@milkdown/plugin-history'
import { clipboard } from '@milkdown/plugin-clipboard'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose, $view } from '@milkdown/utils'
import { ProsemirrorAdapterProvider, useNodeViewFactory, usePluginViewFactory } from '@prosemirror-adapter/react'
import type { NoteDocument } from '../types'
import { NotesEditorActionsContext, type NotesEditorActions } from './notesEditorActions'
import { formattingTooltip, NotesFormattingTooltip } from './NotesFormattingTooltip'
import { insertMenu, NotesInsertMenu } from './NotesInsertMenu'
import { panelEmbed, panelEmbedDrop, panelEmbedDropCursor, panelEmbedRemark, PanelEmbedView } from './notesEmbed'
import '@milkdown/prose/view/style/prosemirror.css'

/**
 * The writing surface: Milkdown (ProseMirror + remark) mounted by hand into
 * a ref. The note goes in once, when the editor is created -- as its
 * structured document when the note has one, as Markdown otherwise -- and
 * every edit comes back out through `onChange` as both, so the store keeps
 * the exact document and the Markdown the exports and bundles need.
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
  const actions = useMemo<NotesEditorActions>(() => ({
    run: (action) => { editorRef.current?.action(action) },
    addKeyHandler: (handler) => {
      keyHandlers.current.add(handler)
      return () => { keyHandlers.current.delete(handler) }
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
  onChange: (markdown: string, document: NoteDocument) => void
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

function NotesEditorInner({ markdown, document: noteDocument, placeholder, onChange, editorRef, keyHandlers }: NotesEditorProps & {
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
        // The tooltip is rendered on the body (see NotesFormattingTooltip
        // for why), so its React portal goes there too.
        ctx.set(formattingTooltip.key, {
          view: pluginViewFactory({ component: NotesFormattingTooltip, root: () => document.body }),
        })
        ctx.set(insertMenu.key, {
          view: pluginViewFactory({ component: NotesInsertMenu, root: () => document.body }),
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(changeReporter((next, doc) => onChangeRef.current(next, { schemaVersion: NOTE_DOCUMENT_SCHEMA_VERSION, doc })))
      .use(placeholderPlugin(placeholder))
      .use(floatingKeys(keyHandlers))
      .use(formattingTooltip)
      .use(insertMenu)
      .use(panelEmbedRemark)
      .use(panelEmbed)
      .use($view(panelEmbed, () => nodeViewFactory({ component: PanelEmbedView, as: 'div', contentAs: 'div' })))
      .use(panelEmbedDrop)
      .use(panelEmbedDropCursor)

    let editor = make(true)
    editorRef.current = editor
    void editor.create().catch(async (error: unknown) => {
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
    })

    return () => {
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
 * Hands every edit to the store, in the same tick as the edit: the document
 * itself (cheap, exact) and its Markdown (for exports and bundles).
 *
 * Milkdown's own listener plugin does the same thing 200ms after the last
 * keystroke and drops the report when the editor is destroyed. Those 200ms
 * are the app's problem: the flush that runs when the tab is hidden or the
 * page is left can only save what the store has heard, so a sentence typed
 * just before closing the tab would be lost. Reporting synchronously costs
 * one serialisation per keystroke; the store's own 500ms debounce still
 * keeps the disk write off the typing path.
 */
function changeReporter(report: (markdown: string, doc: Record<string, unknown>) => void) {
  return $prose((ctx) => new Plugin({
    key: new PluginKey('NOTES_CHANGE_REPORTER'),
    view: () => ({
      update(view, prevState) {
        if (prevState.doc.eq(view.state.doc)) return
        report(ctx.get(serializerCtx)(view.state.doc), view.state.doc.toJSON() as Record<string, unknown>)
      },
    }),
  }))
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
