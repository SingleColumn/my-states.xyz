import type { SyntheticEvent } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  codeBlockPlugin,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  headingsPlugin,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  Separator,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from '@mdxeditor/editor'
import { Download, FilePlus2, Trash2 } from 'lucide-react'
import { useAppState } from '../AppState'
import type { Note } from '../types'

export function NotesPanel() {
  const { notes } = useAppState()

  async function handleDocumentSelection(documentId: string) {
    if (documentId === newDocumentSelectValue) {
      await notes.createNote()
      return
    }

    notes.selectNote(documentId)
  }

  return (
    <section className="panel panel-notes-surface">
      <header className="card-header">
        <h2 className="card-title">Markdown Text Editor</h2>
        <div className="card-header-actions">
          <button
            className="card-icon-button"
            type="button"
            title="New note"
            {...canvasEventBlockerProps}
            onClick={(event) => {
              stopCanvasEvent(event)
              void notes.createNote()
            }}
          >
            <FilePlus2 size={18} />
          </button>
          <button
            className="card-icon-button"
            type="button"
            title="Save markdown file"
            disabled={!notes.activeNote}
            {...canvasEventBlockerProps}
            onClick={(event) => {
              stopCanvasEvent(event)
              if (notes.activeNote) exportMarkdownNote(notes.activeNote)
            }}
          >
            <Download size={18} />
          </button>
          <button
            className="card-icon-button"
            type="button"
            title="Delete note"
            disabled={!notes.activeNote}
            {...canvasEventBlockerProps}
            onClick={(event) => {
              stopCanvasEvent(event)
              if (!notes.activeNote) return
              const confirmed = window.confirm(`Delete "${getDisplayNoteTitle(notes.activeNote)}"?`)
              if (confirmed) void notes.deleteNote(notes.activeNote.id)
            }}
          >
            <Trash2 size={18} />
          </button>
        </div>
      </header>

      <div className="panel-body notes-body">
        <div className="notes-document-controls">
          <label className="note-control-field" {...canvasEventBlockerProps}>
            <span>Document Selector</span>
            <select
              className="note-select"
              value={notes.activeNote?.id ?? ''}
              onChange={(event) => void handleDocumentSelection(event.target.value)}
              aria-label="Document selector"
              {...canvasEventBlockerProps}
            >
              <option value={newDocumentSelectValue}>
                Create new document
              </option>
              {notes.activeNote ? null : (
                <option value="" disabled>
                  Select existing document
                </option>
              )}
              {notes.notes.map((note) => (
                <option key={note.id} value={note.id}>
                  {getDisplayNoteTitle(note)}
                </option>
              ))}
            </select>
          </label>

          <label className="note-control-field" {...canvasEventBlockerProps}>
            <span>Selected Document Name</span>
            <input
              className="note-title-input panel-interactive"
              value={notes.activeNote?.title ?? ''}
              onChange={(event) => notes.setActiveNoteTitle(event.target.value)}
              disabled={!notes.activeNote}
              aria-label="Selected document name"
              placeholder="Name selected document"
              {...canvasEventBlockerProps}
            />
          </label>
        </div>

        {notes.activeNote ? (
          <div className="notes-editor-blocker card-content" {...canvasEventBlockerProps}>
            <MDXEditor
              key={notes.activeNote.id}
              className="notes-rich-editor dark-theme"
              contentEditableClassName="notes-editor-content"
              markdown={notes.activeNote.content}
              placeholder="Start writing..."
              onChange={notes.setActiveNoteContent}
              plugins={notesEditorPlugins}
            />
          </div>
        ) : (
          <button
            className="card-icon-button is-primary is-wide empty-note-button"
            type="button"
            {...canvasEventBlockerProps}
            onClick={(event) => {
              stopCanvasEvent(event)
              void notes.createNote()
            }}
          >
            <FilePlus2 size={18} />
            New note
          </button>
        )}
      </div>

      <footer className="card-footer panel-interactive">
        <span className="card-footer-meta">
          {notes.activeNote ? `${notes.activeNote.content.length} characters` : 'No note selected'}
        </span>
        <div className="card-footer-status">
          <span>{notes.notes.length} notes</span>
        </div>
      </footer>
    </section>
  )
}

const newDocumentSelectValue = '__new_document__'

const canvasEventBlockerProps = {
  onBeforeInput: stopCanvasEvent,
  onClick: stopCanvasEvent,
  onCompositionEnd: stopCanvasEvent,
  onCompositionStart: stopCanvasEvent,
  onCopy: stopCanvasEvent,
  onCut: stopCanvasEvent,
  onDoubleClick: stopCanvasEvent,
  onInput: stopCanvasEvent,
  onKeyDown: stopCanvasEvent,
  onKeyUp: stopCanvasEvent,
  onMouseDown: stopCanvasEvent,
  onPaste: stopCanvasEvent,
  onPointerDown: stopCanvasEvent,
  onPointerMove: stopCanvasEvent,
  onPointerUp: stopCanvasEvent,
  onWheel: stopCanvasEvent,
}

const notesEditorPlugins = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  tablePlugin(),
  thematicBreakPlugin(),
  codeBlockPlugin({ defaultCodeBlockLanguage: 'text' }),
  markdownShortcutPlugin(),
  diffSourcePlugin(),
  toolbarPlugin({
    toolbarClassName: 'notes-editor-toolbar',
    toolbarContents: () => (
      <DiffSourceToggleWrapper>
        <UndoRedo />
        <Separator />
        <BlockTypeSelect />
        <BoldItalicUnderlineToggles />
        <CodeToggle />
        <Separator />
        <ListsToggle />
        <CreateLink />
        <Separator />
        <InsertTable />
        <InsertThematicBreak />
        <InsertCodeBlock />
      </DiffSourceToggleWrapper>
    ),
  }),
]

function stopCanvasEvent(event: SyntheticEvent) {
  event.stopPropagation()
}

function exportMarkdownNote(note: Note) {
  const fileName = `${sanitizeMarkdownFileName(note.title)}.md`
  const blob = new Blob([note.content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function getDisplayNoteTitle(note: Note) {
  return note.title.trim() || 'Untitled document'
}

function sanitizeMarkdownFileName(title: string) {
  const baseName = title
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)

  return baseName || 'untitled-note'
}
