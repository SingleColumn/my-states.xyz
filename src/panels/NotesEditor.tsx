import { useEffect, useRef } from 'react'
import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx, serializerCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { history } from '@milkdown/plugin-history'
import { clipboard } from '@milkdown/plugin-clipboard'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose } from '@milkdown/utils'
import '@milkdown/prose/view/style/prosemirror.css'

/**
 * The writing surface: Milkdown (ProseMirror + remark) mounted by hand into
 * a ref. Markdown goes in once, when the editor is created, and comes back
 * out through `onChange` on every edit -- the same contract the previous
 * editor had, so the notes store is untouched.
 *
 * The parent keys this component on the note id, so a change of note is a
 * fresh mount rather than a value swap; that keeps the caret and the undo
 * history for the note being left from leaking into the one being opened.
 */
export function NotesEditor({ markdown, placeholder, onChange }: {
  markdown: string
  placeholder: string
  onChange: (markdown: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // The callback is read through a ref so a new closure from the parent
  // does not recreate the editor (which would drop the caret mid-sentence).
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host)
        ctx.set(defaultValueCtx, markdown)
        // The class the theme's prose rules already target; ProseMirror puts
        // it on the contenteditable itself, so the writing surface is styled
        // like the previous editor's content area was.
        ctx.set(editorViewOptionsCtx, { attributes: { class: 'notes-editor-content' } })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(changeReporter((next) => onChangeRef.current(next)))
      .use(placeholderPlugin(placeholder))

    void editor.create()

    return () => {
      void editor.destroy()
    }
    // `markdown` is the initial value only; `placeholder` is fixed text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="notes-rich-editor" />
}

/**
 * Hands every edit to the store as Markdown, in the same tick as the edit.
 *
 * Milkdown's own listener plugin does the same thing 200ms after the last
 * keystroke and drops the report when the editor is destroyed. Those 200ms
 * are the app's problem: the flush that runs when the tab is hidden or the
 * page is left can only save what the store has heard, so a sentence typed
 * just before closing the tab would be lost. Reporting synchronously costs
 * one serialisation per keystroke; the store's own 500ms debounce still
 * keeps the disk write off the typing path.
 */
function changeReporter(report: (markdown: string) => void) {
  return $prose((ctx) => new Plugin({
    key: new PluginKey('NOTES_CHANGE_REPORTER'),
    view: () => ({
      update(view, prevState) {
        if (prevState.doc.eq(view.state.doc)) return
        report(ctx.get(serializerCtx)(view.state.doc))
      },
    }),
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
