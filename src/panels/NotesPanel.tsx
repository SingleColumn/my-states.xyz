import { useState, type CSSProperties } from 'react'
import { Download, FilePlus2, Trash2, Type } from 'lucide-react'
import { useAppState } from '../AppState'
import type { Note, Panel } from '../types'
import { PanelHeader, usePanelCommands } from '../PanelHeader'
import { panelContentProps } from '../panelSurface'
import { NotesEditor, type NoteStats } from './NotesEditor'

export function NotesPanel({ panelId }: { panelId: string }) {
  const { notes, panels } = useAppState()
  const commands = usePanelCommands()
  // Full screen is treated as the writing state: the panel sheds its form
  // chrome and becomes a page. The default panel size is deliberately left
  // untouched so the two treatments can be compared side by side.
  const isWritingMode = commands.isPanelFullScreen(panelId)
  const [fontSize, setFontSize] = useState(() => readEditorFontSize())
  // What the footer reports. It comes from the editor rather than from the
  // note's Markdown, which is no longer derived on every keystroke.
  const [stats, setStats] = useState<NoteStats | null>(null)
  const found = panels.get(panelId)
  const activeNoteId = found?.type === 'notes' ? (found as Panel<'notes'>).config.activeNoteId : undefined
  const activeNote = notes.notes.find(note => note.id === activeNoteId) ?? null

  async function handleDocumentSelection(documentId: string) {
    if (documentId === newDocumentSelectValue) {
      await notes.createNote(panelId)
      return
    }

    await notes.selectNote(documentId, panelId)
  }

  // A single note - even the blank one a fresh moment opens with - is not a
  // choice yet, so a dropdown offering nothing but itself and "Create new
  // note" is a control for a choice that doesn't exist.
  const hasNotes = notes.notes.length > 1
  const noteSelect = hasNotes ? (
    <select
      className="app-dropdown note-select"
      value={activeNote?.id ?? ''}
      onChange={(event) => void handleDocumentSelection(event.target.value).catch(() => {})}
      aria-label="Choose a note"
    >
      <option value={newDocumentSelectValue}>
        Create new note
      </option>
      {activeNote ? null : (
        <option value="" disabled>
          Select existing note
        </option>
      )}
      {notes.notes.map((note) => (
        <option key={note.id} value={note.id}>
          {getDisplayNoteTitle(note)}
        </option>
      ))}
    </select>
  ) : null

  return (
    <section className={`panel panel-notes-surface${isWritingMode ? ' is-writing-mode' : ''}`}>
      <PanelHeader
        panelId={panelId}
        panelType="notes"
        title="Writing"
        menuItems={[
          {
            // The formatting bar that used to hold this select is gone, so
            // the size steps round through the ladder from the menu instead.
            id: 'text-size',
            label: `Text size: ${editorFontSizes[fontSize]}`,
            icon: <Type size={17} aria-hidden="true" />,
            onSelect: () => {
              const next = nextEditorFontSize(fontSize)
              setFontSize(next)
              window.localStorage.setItem(editorFontSizeStorageKey, next)
            },
          },
          { id: 'new-note', label: 'New note', icon: <FilePlus2 size={17} aria-hidden="true" />, onSelect: () => { void notes.createNote(panelId).catch(() => {}) } },
          {
            id: 'save-markdown',
            label: 'Save markdown file',
            icon: <Download size={17} aria-hidden="true" />,
            disabled: !activeNote,
            // The Markdown is asked for here rather than read off the note:
            // the editor holds the document, and its Markdown is derived
            // only when something -- this -- needs it.
            onSelect: () => { if (activeNote) exportMarkdownNote(activeNote.title, notes.getNoteMarkdown(panelId)) },
          },
          {
            id: 'delete-note',
            label: 'Delete note',
            icon: <Trash2 size={17} aria-hidden="true" />,
            disabled: !activeNote,
            destructive: true,
            onSelect: () => {
              if (!activeNote) return
              const confirmed = window.confirm(`Delete "${getDisplayNoteTitle(activeNote)}"?`)
              if (confirmed) void notes.deleteNote(activeNote.id, panelId).catch(() => {})
            },
          },
        ]}
      >
        {isWritingMode && hasNotes ? (
          <label className="writing-note-picker">
            <span className="sr-only">Choose a note</span>
            {noteSelect}
          </label>
        ) : null}
      </PanelHeader>

      <div className={`panel-body notes-body${isWritingMode ? ' notes-body-writing' : ''}`}>
        {isWritingMode ? null : (
          <div className="notes-document-controls" {...panelContentProps}>
            {hasNotes ? (
              <label className="note-control-field">
                <span>Choose a note</span>
                {noteSelect}
              </label>
            ) : null}

            <label className="note-control-field">
              <span>Note title</span>
              <input
                className="note-title-input"
                value={activeNote?.title ?? ''}
                onChange={(event) => notes.setActiveNoteTitle(event.target.value, panelId)}
                disabled={!activeNote}
                aria-label="Note title"
                placeholder="Name this note"
              />
            </label>
          </div>
        )}

        {activeNote ? (
          <div
            className={['notes-editor', 'card-content', isWritingMode ? 'is-writing' : ''].filter(Boolean).join(' ')}
            style={{ '--notes-editor-font-size': fontSize } as CSSProperties}
            {...panelContentProps}
          >
            {isWritingMode ? (
              <input
                className="writing-title"
                value={activeNote.title}
                onChange={(event) => notes.setActiveNoteTitle(event.target.value, panelId)}
                aria-label="Note title"
                placeholder="Untitled"
              />
            ) : null}
            <NotesEditor
              key={activeNote.id}
              markdown={activeNote.content}
              document={activeNote.document}
              placeholder={editorPlaceholder}
              onChange={(document, next) => {
                notes.setActiveNoteDocument(document, panelId)
                setStats(next)
              }}
              onMarkdownSource={(render) => notes.registerMarkdownSource(panelId, render)}
            />
          </div>
        ) : (
          <div className="notes-empty-state" {...panelContentProps}>
            <h3>Start a note</h3>
            <button
              className="card-icon-button is-primary is-wide empty-note-button"
              type="button"
              onClick={() => {
                void notes.createNote(panelId).catch(() => {})
              }}
            >
              <FilePlus2 size={18} />
              New note
            </button>
          </div>
        )}
      </div>

      <footer className="card-footer" {...panelContentProps}>
        <span className="card-footer-meta">
          {activeNote
            ? isWritingMode
              ? formatWordCount(stats?.words ?? countWords(activeNote.content))
              : `${stats?.characters ?? activeNote.content.length} characters`
            : 'No note selected'}
        </span>
        <div className="card-footer-status">
          <span>{notes.notes.length} notes</span>
        </div>
      </footer>
    </section>
  )
}

const newDocumentSelectValue = '__new_document__'
const editorFontSizeStorageKey = 'mic:notes-editor-font-size'
const editorFontSizes: Record<string, string> = {
  '14px': 'Small',
  '16px': 'Standard',
  '18px': 'Large',
  '20px': 'Extra large',
}

// The empty page has to carry the discoverability that hidden controls give
// up, so it names the one route to structure a writer needs to know.
const editorPlaceholder = 'Start writing, or type / to add a heading, list, quote, divider or picture.'

function readEditorFontSize() {
  const stored = window.localStorage.getItem(editorFontSizeStorageKey)
  return stored && stored in editorFontSizes ? stored : '18px'
}

function nextEditorFontSize(current: string) {
  const sizes = Object.keys(editorFontSizes)
  return sizes[(sizes.indexOf(current) + 1) % sizes.length]
}

// Counts the note's Markdown, which is what there is to count before the
// editor has reported anything: the moment it does, its own count of the
// prose replaces this one.
function countWords(markdown: string) {
  const words = markdown.trim().match(/\S+/g)
  return words ? words.length : 0
}

function formatWordCount(count: number) {
  return `${count} ${count === 1 ? 'word' : 'words'}`
}

function exportMarkdownNote(title: string, markdown: string) {
  const fileName = `${sanitizeMarkdownFileName(title)}.md`
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
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
  return note.title.trim() || 'Untitled note'
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
