import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Download, FilePlus2, FileUp, Trash2, Type } from 'lucide-react'
import { useAppState } from '../AppState'
import type { Note, Panel } from '../types'
import { PanelHeader, usePanelCommands } from '../PanelHeader'
import { panelContentProps } from '../panelSurface'
import { NotesEditor, type NoteStats, type NotesEditorHandle } from './NotesEditor'

export function NotesPanel({ panelId }: { panelId: string }) {
  const { notes, panels } = useAppState()
  const commands = usePanelCommands()
  // Full screen is treated as the writing state: the panel sheds its form
  // chrome and becomes a page. The default panel size is deliberately left
  // untouched so the two treatments can be compared side by side.
  const isWritingMode = commands.isPanelFullScreen(panelId)
  const [fontSize, setFontSize] = useState(() => readEditorFontSize())
  const [showTools, setShowTools] = useState(() => readShowTools())
  // What the footer reports. It comes from the editor rather than from the
  // note's Markdown, which is no longer derived on every keystroke.
  const [stats, setStats] = useState<NoteStats | null>(null)
  const editorHandle = useRef<NotesEditorHandle | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The writing tools are drawn into this by the editor, which is what lets
  // them read the caret; the panel only decides where they sit.
  const toolbarHostRef = useRef<HTMLDivElement>(null)

  async function openMarkdownFile(file: File) {
    const content = await file.text()
    await notes.createNote(panelId, { title: markdownFileTitle(file.name), content })
  }

  // A title is the first line of writing, not a form field: Enter carries on
  // into the note, and so does Down, since there is no line below it here.
  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' && event.key !== 'ArrowDown') return
    event.preventDefault()
    editorHandle.current?.focusStart()
  }
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
            id: 'formatting-tools',
            label: 'Show formatting tools',
            icon: <Type size={17} aria-hidden="true" />,
            checked: showTools,
            onSelect: () => {
              setShowTools(!showTools)
              try {
                window.localStorage.setItem(showToolsStorageKey, String(!showTools))
              } catch {
                // The choice still holds for this session.
              }
            },
          },
          { id: 'new-note', label: 'New note', icon: <FilePlus2 size={17} aria-hidden="true" />, onSelect: () => { void notes.createNote(panelId).catch(() => {}) } },
          {
            id: 'open-markdown',
            label: 'Open markdown file',
            icon: <FileUp size={17} aria-hidden="true" />,
            // A new note rather than a replacement for the open one: an
            // import that overwrote what was on screen would be a way to
            // lose writing with one wrong click.
            onSelect: () => fileInputRef.current?.click(),
          },
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
        trailingMenuItems={Object.entries(editorFontSizes).map(([size, { label }]) => ({
          id: `text-size-${size}`,
          label,
          icon: <Type size={17} aria-hidden="true" />,
          checked: size === fontSize,
          onSelect: () => {
            setFontSize(size as EditorFontSize)
            window.localStorage.setItem(editorFontSizeStorageKey, size)
          },
        }))}
      >
        {isWritingMode && hasNotes ? (
          <label className="writing-note-picker">
            <span className="sr-only">Choose a note</span>
            {noteSelect}
          </label>
        ) : null}
      </PanelHeader>

      <div
        className={`panel-body notes-body${isWritingMode ? ' notes-body-writing' : ''}`}
        // On the body rather than the editor: the writing tools sit above
        // the editor and line up with the column it holds the text to, so
        // they have to see the size that column is derived from.
        style={{
          '--notes-editor-font-size': editorFontSizes[fontSize].fontSize,
          '--notes-editor-line-height': editorFontSizes[fontSize].lineHeight,
        } as CSSProperties}
      >
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
                onKeyDown={handleTitleKeyDown}
                disabled={!activeNote}
                aria-label="Note title"
                placeholder="Name this note"
              />
            </label>
          </div>
        )}

        {/* Always rendered, hidden when the writer has not asked for it:
            the editor draws the tools into this element as it starts, and a
            host that came and went would leave the drawing with nowhere to
            go. */}
        <div
          className={`notes-writing-toolbar-host${showTools && activeNote ? '' : ' is-hidden'}`}
          ref={toolbarHostRef}
          {...panelContentProps}
        />

        {activeNote ? (
          <div
            className={['notes-editor', 'card-content', isWritingMode ? 'is-writing' : ''].filter(Boolean).join(' ')}
            {...panelContentProps}
          >
            {isWritingMode ? (
              <input
                className="writing-title"
                value={activeNote.title}
                onChange={(event) => notes.setActiveNoteTitle(event.target.value, panelId)}
                onKeyDown={handleTitleKeyDown}
                aria-label="Note title"
                placeholder="Untitled"
              />
            ) : null}
            <NotesEditor
              key={activeNote.id}
              toolbarHost={toolbarHostRef}
              markdown={activeNote.content}
              document={activeNote.document}
              placeholder={editorPlaceholder}
              onChange={(document, next) => {
                notes.setActiveNoteDocument(document, panelId)
                setStats(next)
              }}
              onHandle={(handle) => {
                editorHandle.current = handle
                notes.registerMarkdownSource(panelId, handle ? () => handle.getMarkdown() : null)
              }}
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

      <input
        ref={fileInputRef}
        className="visually-hidden-file-input"
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void openMarkdownFile(file).catch(() => {})
          event.currentTarget.value = ''
        }}
      />

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
const showToolsStorageKey = 'mic:notes-formatting-tools'

/**
 * Whether the writing tools are on show. Off until asked for: the tools are
 * a strip across the top of the writing, and a writer who does not want
 * them should not have to look at them. The `...` menu names them, which is
 * where the previous editor kept the same switch.
 */
function readShowTools() {
  try {
    return window.localStorage.getItem(showToolsStorageKey) === 'true'
  } catch {
    return false
  }
}
// Four steps for reading at, each with the leading that suits it: tighter
// where the line is short, looser where it is long. Medium is the default.
const editorFontSizes = {
  small: { label: 'Small', fontSize: '14px', lineHeight: '21px' },
  medium: { label: 'Medium', fontSize: '16px', lineHeight: '26px' },
  large: { label: 'Large', fontSize: '18px', lineHeight: '29px' },
  xlarge: { label: 'Extra large', fontSize: '21px', lineHeight: '34px' },
} as const
type EditorFontSize = keyof typeof editorFontSizes
const defaultEditorFontSize: EditorFontSize = 'medium'

// The empty page has to carry the discoverability that hidden controls give
// up. The writing tools are off until asked for, so it names where they are
// as well as the shortcut for anyone who would rather type.
const editorPlaceholder = 'Start writing. For headings, lists, pictures and emoji, open the ··· menu and choose Show formatting tools — or type / here.'

function readEditorFontSize(): EditorFontSize {
  const stored = window.localStorage.getItem(editorFontSizeStorageKey)
  // A size from an older ladder is no longer one of the four, so it falls
  // back rather than being kept as a value nothing can name.
  return stored && stored in editorFontSizes ? stored as EditorFontSize : defaultEditorFontSize
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

/**
 * The file's own name, less its extension, is the note's title. The file
 * may well open with a heading saying the same thing; that heading is left
 * where it is rather than lifted out, so what the writer sees in the note
 * is what the file actually said.
 */
function markdownFileTitle(fileName: string) {
  return fileName.replace(/\.(md|markdown|txt)$/i, '').trim()
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
