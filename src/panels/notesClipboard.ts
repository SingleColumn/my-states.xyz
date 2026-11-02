import { Fragment, Slice } from '@milkdown/prose/model'
import type { EditorView } from '@milkdown/prose/view'

/** Insert clipboard words literally, keeping line breaks but no source marks. */
export function pastePlainText(view: EditorView, text: string) {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.includes('\n')) {
    view.dispatch(view.state.tr.insertText(normalized).scrollIntoView())
    return
  }
  const paragraphs = normalized.split('\n').map((line) => view.state.schema.nodes.paragraph.create(null, line ? view.state.schema.text(line) : undefined))
  view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(paragraphs), 0, 0)).scrollIntoView())
}
