import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
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
import { Download, FilePlus2, Trash2, Type } from 'lucide-react'
import { useAppState } from '../AppState'
import type { Note } from '../types'
import type { Panel } from '../types'
import { PanelHeader, usePanelCommands } from '../PanelHeader'

export function NotesPanel({ panelId }: { panelId: string }) {
  const { notes, moments } = useAppState()
  const commands = usePanelCommands()
  // Full screen is treated as the writing state: the panel sheds its form
  // chrome and becomes a page. The default panel size is deliberately left
  // untouched so the two treatments can be compared side by side.
  const isWritingMode = commands.isPanelFullScreen(panelId)
  const [fontSize, setFontSize] = useState(() => readEditorFontSize())
  // The formatting bar is a lot of buttons for two sentences of text, so it
  // starts folded away behind the Aa toggle in both the default panel and
  // writing mode -- one preference, remembered across both.
  const [isToolbarVisible, setIsToolbarVisible] = useState(() => readToolbarVisible())
  const activeNoteId = (moments.activeMoment?.panels.find(panel => panel.id === panelId) as Extract<Panel, { type: 'notes' }> | undefined)?.config.activeNoteId
  const activeNote = notes.notes.find(note => note.id === activeNoteId) ?? null

  async function handleDocumentSelection(documentId: string) {
    if (documentId === newDocumentSelectValue) {
      await notes.createNote(panelId)
      return
    }

    notes.selectNote(documentId, panelId)
  }

  const noteSelect = (
    <select
      className="app-dropdown note-select"
      value={activeNote?.id ?? ''}
      onChange={(event) => void handleDocumentSelection(event.target.value)}
      aria-label="Choose a note"
      {...canvasEventBlockerProps}
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
  )

  return (
    <section className={`panel panel-notes-surface${isWritingMode ? ' is-writing-mode' : ''}`}>
      <PanelHeader
        panelId={panelId}
        panelType="notes"
        title="Notes"
        leadingActions={
          <button
            className={`card-icon-button${isToolbarVisible ? ' is-active' : ''}`}
            type="button"
            title={isToolbarVisible ? 'Hide formatting tools' : 'Show formatting tools'}
            aria-label={isToolbarVisible ? 'Hide formatting tools' : 'Show formatting tools'}
            aria-pressed={isToolbarVisible}
            {...canvasEventBlockerProps}
            onClick={(event) => {
              stopCanvasEvent(event)
              const next = !isToolbarVisible
              setIsToolbarVisible(next)
              window.localStorage.setItem(toolbarVisibleStorageKey, next ? 'true' : 'false')
            }}
          >
            <Type size={18} />
          </button>
        }
      >
          {isWritingMode ? (
            <label className="writing-note-picker" {...canvasEventBlockerProps}>
              <span className="sr-only">Choose a note</span>
              {noteSelect}
            </label>
          ) : null}
          <button
            className="card-icon-button"
            type="button"
            title="New note"
            {...canvasEventBlockerProps}
            onClick={(event) => {
              stopCanvasEvent(event)
              void notes.createNote(panelId)
            }}
          >
            <FilePlus2 size={18} />
          </button>
          <button
            className="card-icon-button"
            type="button"
            title="Save markdown file"
            disabled={!activeNote}
            {...canvasEventBlockerProps}
            onClick={(event) => {
              stopCanvasEvent(event)
              if (activeNote) exportMarkdownNote(activeNote)
            }}
          >
            <Download size={18} />
          </button>
          <button
            className="card-icon-button"
            type="button"
            title="Delete note"
            disabled={!activeNote}
            {...canvasEventBlockerProps}
            onClick={(event) => {
              stopCanvasEvent(event)
              if (!activeNote) return
              const confirmed = window.confirm(`Delete "${getDisplayNoteTitle(activeNote)}"?`)
              if (confirmed) void notes.deleteNote(activeNote.id, panelId)
            }}
          >
            <Trash2 size={18} />
          </button>
      </PanelHeader>

      <div className={`panel-body notes-body${isWritingMode ? ' notes-body-writing' : ''}`}>
        {isWritingMode ? null : (
          <div className="notes-document-controls">
            <label className="note-control-field" {...canvasEventBlockerProps}>
              <span>Choose a note</span>
              {noteSelect}
            </label>

            <label className="note-control-field" {...canvasEventBlockerProps}>
              <span>Note title</span>
              <input
                className="note-title-input panel-interactive"
                value={activeNote?.title ?? ''}
                onChange={(event) => notes.setActiveNoteTitle(event.target.value, panelId)}
                disabled={!activeNote}
                aria-label="Note title"
                placeholder="Name this note"
                {...canvasEventBlockerProps}
              />
            </label>
          </div>
        )}

        {activeNote ? (
          <div
            className={[
              'notes-editor-blocker',
              'card-content',
              isWritingMode ? 'is-writing' : '',
              isToolbarVisible ? '' : 'is-toolbar-hidden',
            ].filter(Boolean).join(' ')}
            style={{ '--notes-editor-font-size': fontSize } as CSSProperties}
            {...canvasEventBlockerProps}
          >
            {isWritingMode ? (
              <input
                className="writing-title panel-interactive"
                value={activeNote.title}
                onChange={(event) => notes.setActiveNoteTitle(event.target.value, panelId)}
                aria-label="Note title"
                placeholder="Untitled"
                {...canvasEventBlockerProps}
              />
            ) : null}
            <MDXEditor
              key={activeNote.id}
              className="notes-rich-editor dark-theme"
              contentEditableClassName="notes-editor-content"
              markdown={activeNote.content}
              placeholder={editorPlaceholder}
              onChange={(content) => notes.setActiveNoteContent(content, panelId)}
              plugins={createNotesEditorPlugins(fontSize, (value) => {
                setFontSize(value)
                window.localStorage.setItem(editorFontSizeStorageKey, value)
              })}
            />
          </div>
        ) : (
          <div className="notes-empty-state">
            <h3>Start a note</h3>
            <button
              className="card-icon-button is-primary is-wide empty-note-button"
              type="button"
              {...canvasEventBlockerProps}
              onClick={(event) => {
                stopCanvasEvent(event)
                void notes.createNote(panelId)
              }}
            >
              <FilePlus2 size={18} />
              New note
            </button>
          </div>
        )}
      </div>

      <footer className="card-footer panel-interactive">
        <span className="card-footer-meta">
          {activeNote
            ? isWritingMode
              ? formatWordCount(countWords(activeNote.content))
              : `${activeNote.content.length} characters`
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
const toolbarVisibleStorageKey = 'mic:notes-toolbar-visible'
const editorFontSizes = new Set(['14px', '16px', '18px', '20px'])

// The empty page has to carry the discoverability that the hidden toolbar
// gives up, so it names the two routes to formatting that exist today.
const editorPlaceholder = 'Start writing. Type # for a heading or - for a list, or open Aa above for all formatting.'

function readEditorFontSize() {
  const stored = window.localStorage.getItem(editorFontSizeStorageKey)
  return stored && editorFontSizes.has(stored) ? stored : '18px'
}

function readToolbarVisible() {
  return window.localStorage.getItem(toolbarVisibleStorageKey) === 'true'
}

// Counts the markdown source, so syntax like "##" or "*" inflates the total
// slightly. Close enough to be useful while writing, and far more meaningful
// to a writer than a character count.
function countWords(markdown: string) {
  const words = markdown.trim().match(/\S+/g)
  return words ? words.length : 0
}

function formatWordCount(count: number) {
  return `${count} ${count === 1 ? 'word' : 'words'}`
}

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

function createNotesEditorPlugins(fontSize: string, onFontSizeChange: (value: string) => void) {
  return [
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
  // The toolbar plugin stays mounted in every mode and the bar is hidden with
  // CSS instead. Dropping the plugin would remount the editor on each toggle,
  // losing the caret position and the undo history mid-sentence.
  toolbarPlugin({
    toolbarClassName: 'notes-editor-toolbar',
    toolbarContents: () => (
      <div className="notes-editor-toolbar-interaction-surface" onPointerDownCapture={handleToolbarPointerDownCapture}>
        <DiffSourceToggleWrapper>
        <UndoRedo />
        <Separator />
        <BlockTypeSelect />
        <label className="notes-font-size-control">
          <span className="sr-only">Editor font size</span>
          <select
            className="app-dropdown"
            aria-label="Editor font size"
            value={fontSize}
            onChange={(event) => onFontSizeChange(event.target.value)}
          >
            <option value="14px">Small</option>
            <option value="16px">Standard</option>
            <option value="18px">Large</option>
            <option value="20px">Extra large</option>
          </select>
        </label>
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
      </div>
    ),
  }),
  ]
}

function handleToolbarPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
  const target = event.target
  if (!(target instanceof Element)) return

  const trigger = target.closest('[role="combobox"]')
  if (!(trigger instanceof HTMLElement) || trigger.dataset.state !== 'open') return

  // Radix Select closes on Escape. Prevent its pointer handler from toggling
  // the trigger back open after this explicit close action.
  event.preventDefault()
  trigger.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
  }))
}

function stopCanvasEvent(event: SyntheticEvent) {
  if ('button' in event && event.button === 2) return
  // Radix uses document-level pointer events to detect outside clicks. Let
  // select triggers and options bubble so clicking the open trigger can close
  // the menu again.
  if (event.target instanceof Element && event.target.closest('[role="combobox"], [role="option"], [data-radix-select-viewport]')) {
    return
  }

  // The notes editor needs the browser's native drag-to-select behavior. The
  // killed flag prevents most tldraw handling, while stopping propagation
  // keeps the canvas pointer handlers from starting a panel drag during a
  // selection gesture.
  event.stopPropagation()
  event.nativeEvent.stopPropagation()

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
