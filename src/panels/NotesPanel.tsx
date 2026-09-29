import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePostHog } from '@posthog/react'
import { CopyPlus, Download, FilePlus2, FileUp, Ruler, Trash2, Type } from 'lucide-react'
import { useAppState } from '../AppState'
import type { Note, Panel } from '../types'
import { markdownNamedAsCopy } from '../noteTitle'
import { PanelHeader, usePanelCommands } from '../PanelHeader'
import { panelContentProps, panelScrollProps } from '../panelSurface'
import { NotesEditor, type NoteStats, type NotesEditorHandle } from './NotesEditor'

export function NotesPanel({ panelId }: { panelId: string }) {
  const posthog = usePostHog()
  const { notes, panels } = useAppState()
  const commands = usePanelCommands()
  // Full screen is treated as the writing state: the panel sheds its form
  // chrome and becomes a page. The default panel size is deliberately left
  // untouched so the two treatments can be compared side by side.
  const isWritingMode = commands.isPanelFullScreen(panelId)
  const [fontSize, setFontSize] = useState(() => readEditorFontSize())
  const [paperWidth, setPaperWidth] = useState(() => readPaperWidth())
  const [showTools, setShowTools] = useState(() => readShowTools())
  // What the footer reports. It comes from the editor rather than from the
  // note's Markdown, which is no longer derived on every keystroke.
  const [stats, setStats] = useState<NoteStats | null>(null)
  const editorHandle = useRef<NotesEditorHandle | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The writing tools are drawn into this by the editor, which is what lets
  // them read the caret; the panel only decides where they sit.
  const toolbarHostRef = useRef<HTMLDivElement>(null)
  const writingMilestonesRef = useRef({ noteId: null as string | null, started: false, fiftyWords: false, twoHundredWords: false })
  const wasInWritingModeRef = useRef(isWritingMode)

  useEffect(() => {
    if (isWritingMode && !wasInWritingModeRef.current) {
      posthog.capture('writing_mode_entered', { writing_mode: true, panel_id: panelId })
    }
    wasInWritingModeRef.current = isWritingMode
  }, [isWritingMode, panelId, posthog])

  async function openMarkdownFile(file: File) {
    // Every Markdown this app writes uses \n alone -- every toMarkdown
    // runner does -- so a file carrying \r\n or a lone \r (Windows editors,
    // some exports) is normalised on the way in. Without this the note's
    // stored content kept the file's own line endings verbatim until an
    // edit next settled it, which is one string for a note that had never
    // been touched and a different one, silently, the moment it was.
    const content = (await file.text()).replace(/\r\n?/g, '\n')
    await notes.createNote(panelId, { title: markdownFileTitle(file.name), content })
  }

  const found = panels.get(panelId)
  const activeNoteId = found?.type === 'notes' ? (found as Panel<'notes'>).config.activeNoteId : undefined
  // A note is written by one panel at a time. This one may be holding a
  // reference to a note another panel already has open -- which is what a
  // duplicated Writing panel starts life with -- and if it opened it too,
  // whichever was typed in last would write the whole note over the other.
  const heldBy = activeNoteId ? notes.noteOpenElsewhere(activeNoteId, panelId) : null
  const namedNote = notes.notes.find(note => note.id === activeNoteId) ?? null
  const activeNote = heldBy === null ? namedNote : null

  function captureWritingProgress(words: number) {
    const noteId = activeNote?.id
    if (!noteId) return

    if (writingMilestonesRef.current.noteId !== noteId) {
      writingMilestonesRef.current = { noteId, started: false, fiftyWords: false, twoHundredWords: false }
    }

    const milestones = writingMilestonesRef.current
    const writingContext = { writing_mode: isWritingMode, panel_id: panelId }
    if (words > 0 && !milestones.started) {
      posthog.capture('writing_started', writingContext)
      milestones.started = true
    }
    if (words >= 50 && !milestones.fiftyWords) {
      posthog.capture('writing_50_words', writingContext)
      milestones.fiftyWords = true
    }
    if (words >= 200 && !milestones.twoHundredWords) {
      posthog.capture('writing_200_words', writingContext)
      milestones.twoHundredWords = true
    }
  }

  async function copyNoteHere() {
    if (!namedNote || heldBy === null) return
    // Asked of the panel holding it, so the copy is what is on that screen
    // rather than what was last written to storage.
    const content = notes.getNoteMarkdown(heldBy)
    await notes.createNote(panelId, {
      title: '',
      content: markdownNamedAsCopy(content, notes.notes.map(getDisplayNoteTitle)),
    })
  }

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
      {notes.notes.map((note) => {
        // Shown but not choosable: a note missing from the list is one the
        // writer goes looking for, where one that says where it is answers
        // the question instead.
        const elsewhere = notes.noteOpenElsewhere(note.id, panelId) !== null
        return (
          <option key={note.id} value={note.id} disabled={elsewhere}>
            {getDisplayNoteTitle(note)}{elsewhere ? ' — open in another Writing panel' : ''}
          </option>
        )
      })}
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
        trailingMenuItems={[
          ...Object.entries(editorFontSizes).map(([size, { label }]) => ({
            id: `text-size-${size}`,
            label,
            icon: <Type size={17} aria-hidden="true" />,
            checked: size === fontSize,
            onSelect: () => {
              setFontSize(size as EditorFontSize)
              window.localStorage.setItem(editorFontSizeStorageKey, size)
            },
          })),
          ...Object.entries(paperWidths).map(([width, { label }]) => ({
            id: `paper-width-${width}`,
            label: `Paper: ${label}`,
            icon: <Ruler size={17} aria-hidden="true" />,
            checked: width === paperWidth,
            onSelect: () => {
              setPaperWidth(width as PaperWidth)
              window.localStorage.setItem(paperWidthStorageKey, width)
            },
          })),
        ]}
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
          '--notes-paper-width': paperWidths[paperWidth].width,
        } as CSSProperties}
      >
        {/* No title field in either treatment: the note is named by its
            first line, so the name is written where it is read. What is
            left here is the choice of note, and only when there is one. */}
        {isWritingMode || !hasNotes ? null : (
          <div className="notes-document-controls" {...panelContentProps}>
            <label className="note-control-field">
              <span>Choose a note</span>
              {noteSelect}
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
            className={['notes-editor', 'card-content', 'ph-mask', isWritingMode ? 'is-writing' : ''].filter(Boolean).join(' ')}
            {...panelContentProps}
            // What the wheel scrolls when it lands somewhere with nothing
            // scrollable above it -- the note's title, which sits beside the
            // editor's scroll box rather than inside it.
            {...panelScrollProps}
          >
            <NotesEditor
              key={activeNote.id}
              toolbarHost={toolbarHostRef}
              markdown={activeNote.content}
              document={activeNote.document}
              placeholder={editorPlaceholder}
              onChange={(document, next, title) => {
                notes.setActiveNoteDocument(document, panelId, activeNote.id)
                // Only when the first line's words actually change. The
                // document is kept out of React state on purpose (see
                // NotesEditor), but the name is in it -- every note list in
                // the app reads it -- so writing it on every keystroke
                // would re-render all of them for a note being typed into.
                if (title !== activeNote.title) notes.setActiveNoteTitle(title, panelId, activeNote.id)
                setStats(next)
                captureWritingProgress(next.words)
              }}
              onHandle={(handle) => {
                editorHandle.current = handle
                notes.registerEditor(panelId, handle, activeNote.id)
              }}
            />
          </div>
        ) : heldBy !== null ? (
          <div className="notes-empty-state" {...panelContentProps}>
            <h3>Open in another Writing panel</h3>
            <p className="notes-empty-hint">
              A note is written in one panel at a time, so that two panels cannot
              write over each other.
            </p>
            <button
              className="card-icon-button is-primary is-wide empty-note-button"
              type="button"
              onClick={() => { void copyNoteHere().catch(() => {}) }}
            >
              <CopyPlus size={18} />
              Make a copy here
            </button>
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
const paperWidthStorageKey = 'mic:notes-paper-width'
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

const paperWidths = {
  narrow: { label: 'Narrow', width: '680px' },
  standard: { label: 'A4', width: '794px' },
  wide: { label: 'Wide', width: '960px' },
} as const
type PaperWidth = keyof typeof paperWidths
const defaultPaperWidth: PaperWidth = 'standard'

function readPaperWidth(): PaperWidth {
  try {
    const stored = window.localStorage.getItem(paperWidthStorageKey)
    return stored && stored in paperWidths ? stored as PaperWidth : defaultPaperWidth
  } catch {
    return defaultPaperWidth
  }
}

// Four steps for reading at, each with the leading that suits it: tighter
// where the line is short, looser where it is long. Medium is the default.
const editorFontSizes = {
  small: { label: 'Small', fontSize: '16px', lineHeight: '25px' },
  medium: { label: 'Medium', fontSize: '18px', lineHeight: '30px' },
  large: { label: 'Large', fontSize: '20px', lineHeight: '34px' },
  xlarge: { label: 'Extra large', fontSize: '23px', lineHeight: '40px' },
} as const
type EditorFontSize = keyof typeof editorFontSizes
const defaultEditorFontSize: EditorFontSize = 'medium'

// The empty page has to carry the discoverability that hidden controls give
// up. The writing tools are off until asked for, so it names where they are
// as well as the shortcut for anyone who would rather type.
const editorPlaceholder = 'The first line names this note. For headings, lists, pictures and emoji, open the ··· menu and choose Show formatting tools — or type / here.'

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
