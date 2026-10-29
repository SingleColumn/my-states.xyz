import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note, NoteDocument, Panel, Board } from './types'
import { deleteNote as deleteStoredNote, getNotes, saveNote } from './storage'
import { createId } from './utils'
import { SaveQueue } from './saveQueue'
import type { SaveStatusStore } from './saveStatus'
import { persistNoteSnapshot } from './notePersistence'
import { BoardOperation } from './boardOperation'
import type { NotesEditorHandle } from './panels/NotesEditor'
import { markdownHeadingForText, noteTitleFromMarkdown } from './noteTitle'
import type { PanelsState } from './AppState'

/** A note's starting title and Markdown, when it does not start empty. */
export interface NoteOpening {
  title: string
  content: string
}

export interface NotesState {
  notes: Note[]
  error: string | null
  /**
   * A write in the note's Markdown -- the command surface's form. It makes
   * the Markdown the truth again, dropping any document written beside it.
   */
  setActiveNoteContent(content: string, panelId: string): void
  /**
   * A write from the editor, which holds the note as a structured document.
   * Only the document is taken here: deriving its Markdown costs tens of
   * milliseconds on a long note, far too much to spend on every keystroke,
   * so it is left until something asks -- a save, an export, the editor
   * going away. See `registerEditor`.
   */
  setActiveNoteDocument(document: NoteDocument, panelId: string, noteId: string): void
  /**
   * The panel's mounted editor: what offers the note's Markdown on demand
   * and what a rename edits. Registering null (as the editor goes) settles
   * the note's Markdown one last time, since nothing can derive it
   * afterwards.
   */
  registerEditor(panelId: string, editor: NotesEditorHandle | null, noteId: string): void
  /**
   * Renames a note by rewriting its first line, which is what names it.
   * For the command surface; the editor's own reading of that line comes
   * back through `setActiveNoteTitle` instead.
   */
  renameNote(title: string, panelId: string): void
  /** The note's Markdown, brought up to date first. */
  getNoteMarkdown(panelId: string): string
  /**
   * The panel a note is open in, when that is not this one.
   *
   * A note is written by one panel at a time. Each editor takes the note as
   * it mounts and owns it from then on, so two panels on the same note each
   * hold their own copy of it and whichever is typed in last writes the
   * whole thing over the other -- silently, and with no way back. Rather
   * than make one document two panels can share, which is a different piece
   * of work altogether, the second panel does not open it.
   */
  noteOpenElsewhere(noteId: string, panelId: string): string | null
  setActiveNoteTitle(title: string, panelId: string, noteId: string): void
  /** A blank note, or one opened from a Markdown file the reader chose. */
  createNote(panelId: string, opening?: NoteOpening): Promise<void>
  selectNote(id: string, panelId: string): Promise<void>
  deleteNote(id: string, panelId: string): Promise<void>
  flush(): Promise<void>
}

export function useNotesState(board: Board | null, panels: PanelsState, operation: BoardOperation, saveStatus: SaveStatusStore): NotesState {
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saveQueue] = useState(() => {
    // Notes are written through their own queue, so they report into the same
    // status as the board, or the toolbar would say "Saved" over a failed note.
    const noteWrites = saveStatus.source()
    return new SaveQueue(
      (caught) => {
        noteWrites.markFailed()
        setError(caught instanceof Error ? caught.message : 'Could not save your note. Keep this tab open and try again.')
      },
      noteWrites.markBusy,
    )
  })
  const panelsRef = useRef(panels)
  panelsRef.current = panels
  // Which board `notes` actually holds loaded notes for. A board switch
  // updates panels synchronously (tldraw's own store) but notes only once
  // this hook's async load effect below finishes, so between those two
  // points panelId can already name the new board while `notes` still
  // holds the old one's. Set only at the board load() actually replaces
  // `notes` with real data for `boardId` - never for the board a switch
  // is merely heading towards.
  const notesLoadedForRef = useRef('')
  const runNoteOperation = useCallback((work: () => Promise<void>) => operation.run(work).catch((caught) => {
    setError(caught instanceof Error ? caught.message : 'Could not finish the note operation. Your unsaved draft has been kept.')
    throw caught
  }), [operation])

  /**
   * Brings the note's Markdown up to date with its document, if an editor
   * is there to derive it. Called before anything reads or stores the
   * Markdown, which is the only work the typing path defers.
   */
  const settleMarkdown = useCallback((panelId: string): Note | null => {
    const state = getNotesPanelRuntimeState(panelId)
    const current = state.activeNote
    if (!current) return null
    if (!state.markdownStale || !state.editor || state.editor.noteId !== current.id) return current
    const next: Note = { ...current, content: state.editor.handle.getMarkdown(), updatedAt: Date.now() }
    state.markdownStale = false
    state.activeNote = next
    setNotes((currentNotes) => currentNotes.map((note) => note.id === next.id ? next : note))
    return next
  }, [])

  const persistPanelNote = useCallback(async (panelId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    // The Markdown is derived here rather than on the typing path, so what
    // is written is always the note as it stands now.
    const note = settleMarkdown(panelId)
    if (note && state.dirty) {
      // Each panel's draft needs its own acknowledgement, even when two
      // panels refer to the same note. Coalescing by note id loses one ack.
      saveQueue.enqueue(`${panelId}:${note.id}`, async () => {
        await persistNoteSnapshot(state, note, saveNote)
        setError(null)
      })
    }
    await saveQueue.flush()
  }, [saveQueue, settleMarkdown])

  const flush = useCallback(async (panelId?: string) => {
    const panelIds = panelId
      ? [panelId]
      : [...notesPanelRuntimeStates.keys()]
    await Promise.all(panelIds.map(async (id) => {
      const state = getNotesPanelRuntimeState(id)
      if (state.saveTimer !== null) {
        window.clearTimeout(state.saveTimer)
        state.saveTimer = null
      }
      await persistPanelNote(id)
    }))
  }, [persistPanelNote])

  // The loading boundary is the board, once the canvas has restored it:
  // which note each Notes panel shows is read from the panels then.
  const loadKey = panels.isReady ? board?.id ?? '' : ''
  useEffect(() => {
    let cancelled = false
    const boardId = loadKey
    const notePanels = panelsRef.current.all.filter((panel): panel is Panel<'notes'> => panel.type === 'notes')

    async function load() {
      await flush()
      if (cancelled) return
      for (const state of notesPanelRuntimeStates.values()) {
        state.activeNote = null
        state.dirty = false
        state.markdownStale = false
        if (state.saveTimer !== null) window.clearTimeout(state.saveTimer)
        state.saveTimer = null
      }
      setNotes([])
      if (!boardId) return
      const storedNotes = await getNotes(boardId)
      if (cancelled) return
      // A board with no notes yet (freshly created, or its last note just
      // removed) opens with a blank note already active, rather than
      // making the writer click through an empty state to start one.
      if (storedNotes.length === 0 && notePanels.length > 0) {
        const now = Date.now()
        // No name: a note is named by its first line, and nothing has been
        // written at the top of this one yet. Every list that shows it says
        // "Untitled note" in place of the empty name.
        const blank: Note = { id: createId('note'), boardId, title: '', content: '', createdAt: now, updatedAt: now }
        await saveNote(blank)
        if (cancelled) return
        setNotes([blank])
        notesLoadedForRef.current = boardId
        for (const panel of notePanels) {
          getNotesPanelRuntimeState(panel.id).activeNote = blank
          panelsRef.current.updateConfig<'notes'>(panel.id, { activeNoteId: blank.id })
        }
        return
      }
      const openedNotes = await Promise.all(storedNotes.map(withNameAsFirstLine))
      if (cancelled) return
      setNotes(openedNotes)
      notesLoadedForRef.current = boardId
      for (const panel of notePanels) {
        const selected = openedNotes.find((note) => note.id === panel.config.activeNoteId) ?? openedNotes[0] ?? null
        getNotesPanelRuntimeState(panel.id).activeNote = selected
      }
    }
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load your notes.'))

    return () => {
      cancelled = true
      void flush().catch(() => {})
    }
  }, [flush, loadKey])

  // The note a panel edits follows the panel's configuration: a Notes panel
  // that arrives after the load (undo of a delete, a copy, a command) or
  // whose active note changes under it (undo of a selection) picks up the
  // note the shape names. Unsaved typing is never displaced.
  const noteSignature = panels.all
    .filter((panel): panel is Panel<'notes'> => panel.type === 'notes')
    .map((panel) => `${panel.id}=${panel.config.activeNoteId ?? ''}`)
    .join('|')
  useEffect(() => {
    if (!loadKey) return
    for (const panel of panelsRef.current.all) {
      if (panel.type !== 'notes') continue
      const state = getNotesPanelRuntimeState(panel.id)
      const wanted = panel.config.activeNoteId
      if ((state.activeNote?.id ?? null) === wanted || state.dirty) continue
      state.activeNote = notes.find((note) => note.id === wanted) ?? null
    }
  }, [loadKey, noteSignature, notes])

  const scheduleSave = useCallback((panelId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    state.dirty = true
    if (state.saveTimer !== null) window.clearTimeout(state.saveTimer)
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null
      void persistPanelNote(panelId).catch(() => {})
    }, 500)
  }, [persistPanelNote])

  /**
   * Which panel owns a note: the one that opened it first, which is the one
   * with the lowest id, since an id carries the board it was made in.
   *
   * Deliberately not the first in `panels.all`: that is stacking order, and
   * it changes when a panel is brought to the front -- expanding one to full
   * screen does exactly that -- so the note would change hands for reasons
   * that have nothing to do with the note.
   */
  const noteOpenElsewhere = useCallback((noteId: string, panelId: string) => {
    let owner: string | null = null
    for (const panel of panels.all) {
      if (panel.type !== 'notes' || panel.config.activeNoteId !== noteId) continue
      if (owner === null || panel.id < owner) owner = panel.id
    }
    return owner === null || owner === panelId ? null : owner
  }, [panels])

  const createNote = useCallback((panelId: string, opening?: NoteOpening) => runNoteOperation(async () => {
    if (!board) return
    await flush(panelId)
    const now = Date.now()
    const openingTitle = opening ? noteTitleFromMarkdown(opening.content) : ''
    const fallbackHeading = opening && !openingTitle ? markdownHeadingForText(opening.title) : ''
    const content = fallbackHeading ? `${fallbackHeading}\n\n${opening!.content}` : opening?.content ?? ''
    const note: Note = {
      id: createId('note'),
      boardId: board.id,
      // The first line names the note. A file that starts with a text line
      // uses it; otherwise its file name is written in as a heading so the
      // stored name and the writing never begin life in disagreement.
      title: openingTitle || opening?.title.trim() || '',
      // A note opened from a file starts as its Markdown and no document:
      // the same road an older note takes, which the editor already reads.
      content,
      createdAt: now,
      updatedAt: now,
    }
    await saveNote(note)
    const state = getNotesPanelRuntimeState(panelId)
    state.activeNote = note
    setNotes((current) => [note, ...current])
    panels.updateConfig<'notes'>(panelId, { activeNoteId: note.id })
  }), [panels, board, flush, runNoteOperation])

  const selectNote = useCallback((id: string, panelId: string) => {
    // notesLoadedForRef, not just membership: right after a board switch,
    // panelId can already belong to the new board while `notes` still
    // holds the old one's, and an old note's id would otherwise be found
    // "valid" and get written onto the new board's panel.
    if (notesLoadedForRef.current !== loadKey) return Promise.resolve()
    const next = notes.find((note) => note.id === id)
    if (!next) return Promise.resolve()
    // Returns the operation's own promise rather than firing it and
    // forgetting: a caller through the command surface (canvasApi.ts) needs
    // its await to mean the selection has actually landed, and its
    // rejection to actually reach the caller.
    // Refused rather than allowed and then repaired: opening it here would
    // put two editors on one note, and the one that loses is the one whose
    // writing goes.
    if (noteOpenElsewhere(id, panelId)) {
      setError('That note is open in another Writing panel. Close it there, or make a copy of it here.')
      return Promise.reject(new Error('That note is open in another Writing panel.'))
    }
    return runNoteOperation(async () => {
      await flush(panelId)
      getNotesPanelRuntimeState(panelId).activeNote = next
      panels.updateConfig<'notes'>(panelId, { activeNoteId: next.id })
    })
  }, [flush, loadKey, noteOpenElsewhere, notes, panels, runNoteOperation])

  const deleteNote = useCallback((id: string, panelId: string) => runNoteOperation(async () => {
    // deleteStoredNote deletes by id alone, with no board to scope it to.
    // A stale or foreign id (retained across a board switch, say) must
    // never reach it: it would permanently delete a note out of whichever
    // board actually owns it, leaving that board's own panels pointing
    // at a note that no longer exists - the same failure this function's
    // own redirect loop below exists to prevent, reached through a
    // different door. Mirrors the same check selectNote already makes -
    // gated on notesLoadedForRef too, not just membership in `notes`: a
    // panelId can already belong to a board just switched into while
    // `notes` still holds the one just left, and a foreign note's id would
    // otherwise be found "valid" in that stale array.
    if (notesLoadedForRef.current !== loadKey || !notes.some((note) => note.id === id)) return
    await flush(panelId)
    await deleteStoredNote(id)
    const nextNotes = notes.filter((note) => note.id !== id)
    setNotes(nextNotes)
    const fallback = nextNotes[0] ?? null
    // Every Notes panel that showed the deleted note follows it, not only
    // the one the delete came through: a second panel left pointing at a
    // vanished note is a dangling reference an export cannot come back
    // from on import (see the archive validation in boardArchive.ts).
    for (const panel of panels.all) {
      if (panel.type !== 'notes' || panel.config.activeNoteId !== id) continue
      const state = getNotesPanelRuntimeState(panel.id)
      if (state.saveTimer !== null) {
        window.clearTimeout(state.saveTimer)
        state.saveTimer = null
      }
      state.activeNote = fallback
      state.dirty = false
      panels.updateConfig<'notes'>(panel.id, { activeNoteId: fallback?.id ?? null })
    }
  }), [flush, loadKey, notes, panels, runNoteOperation])

  const setActiveNoteContent = useCallback((content: string, panelId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    const current = state.activeNote
    if (!current) return
    const { document: _dropped, ...rest } = current
    const next: Note = { ...rest, title: noteTitleFromMarkdown(content), content, updatedAt: Date.now() }
    state.activeNote = next
    state.markdownStale = false
    setNotes((currentNotes) => currentNotes.map((note) => note.id === next.id ? next : note))
    scheduleSave(panelId)
    // Markdown commands are document producers too. Keep the mounted editor
    // on the same truth immediately; otherwise its next keystroke serialises
    // the old document back over the command's content.
    if (state.editor?.noteId === next.id) state.editor.handle.setMarkdown(content)
  }, [scheduleSave])

  const setActiveNoteDocument = useCallback((document: NoteDocument, panelId: string, noteId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    const current = state.activeNote
    if (!current || current.id !== noteId) return
    // Kept off React state: like the Markdown, the document is read from the
    // note only when an editor opens it, and settling writes both back.
    state.activeNote = { ...current, document }
    state.markdownStale = true
    scheduleSave(panelId)
  }, [scheduleSave])

  const registerEditor = useCallback((panelId: string, editor: NotesEditorHandle | null, noteId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    if (editor) {
      // An async mount can finish after the panel has moved on. It must not
      // become the handle for the newly active note or report into it.
      if (state.activeNote?.id !== noteId) return
      state.editor = { noteId, handle: editor }
      // A rename that arrived while this editor was still mounting. Applied
      // only if it named the note this editor actually holds.
      const waiting = state.pendingRename
      if (waiting && waiting.noteId === noteId) {
        state.pendingRename = null
        editor.setTitle(waiting.title)
      }
      return
    }
    // A stale editor's teardown must not withdraw the current editor.
    if (state.editor?.noteId === noteId) {
      settleMarkdown(panelId)
      state.editor = null
    }
  }, [settleMarkdown])

  /**
   * Renames a note through the command surface, by writing the new name into
   * the first line -- which is what names a note.
   *
   * Not `setActiveNoteTitle`: that is fed *by* the editor's reading of the
   * first line, so a name written there alone survives until the next
   * keystroke and no longer. Worse, a note reloaded before that keystroke
   * looks like one whose name is missing from its writing, and is given the
   * requested name a second time as a heading above what it already said.
   *
   * Does nothing when the panel has no editor mounted, which is to say when
   * it is not showing the note being renamed.
   */
  const renameNote = useCallback((title: string, panelId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    const open = state.activeNote
    if (!open) return
    // Only this note's own editor. A panel just pointed at another note
    // still has the outgoing note's editor standing for a board, and
    // renaming through that would write this name into the note being left.
    if (state.editor && state.editor.noteId === open.id) {
      state.editor.handle.setTitle(title)
      return
    }
    // The editor mounts a board after the note is opened, and a command can
    // land inside that board -- a script renaming a note it has just made,
    // whose await returned before any editor existed. The rename waits for
    // the editor instead of being dropped on the floor while the command
    // reports success. Tied to the note it was meant for, so a rename cannot
    // come down on a different note opened in the meantime.
    state.pendingRename = { noteId: open.id, title }
  }, [])

  const getNoteMarkdown = useCallback((panelId: string) => {
    return settleMarkdown(panelId)?.content ?? ''
  }, [settleMarkdown])

  const setActiveNoteTitle = useCallback((title: string, panelId: string, noteId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    const current = state.activeNote
    if (!current || current.id !== noteId) return
    const next = { ...current, title, updatedAt: Date.now() }
    state.activeNote = next
    setNotes((currentNotes) => currentNotes.map((note) => note.id === next.id ? next : note))
    scheduleSave(panelId)
  }, [scheduleSave])

  return { notes, error, setActiveNoteContent, setActiveNoteDocument, registerEditor, renameNote, getNoteMarkdown, noteOpenElsewhere, setActiveNoteTitle, createNote, selectNote, deleteNote, flush }
}

/**
 * Brings a note written when the title was a field of its own onto the
 * footing the writing panel now works on, where a note is named by its
 * first line: the name it was given is written in as a heading at the top,
 * so the note still answers to it and the writer still sees it.
 *
 * The stored document is dropped with it. That document was built from
 * content with no title line in it and is preferred over the Markdown on
 * load, so keeping it would mean the heading was written and then never
 * shown. With no document the editor reads the Markdown, and the first
 * edit writes a fresh document beside it.
 *
 * Idempotent: once the heading is there the first line already says the
 * name, and the note is handed back untouched on every later load.
 */
async function withNameAsFirstLine(note: Note): Promise<Note> {
  const stored = note.title.trim()
  // What the note will call itself the board it is opened. A first line
  // that starts a list or a quotation names nothing -- the editor puts an
  // empty line above it -- so the name is empty rather than that block's
  // words.
  const derived = noteTitleFromMarkdown(note.content)
  if (derived === stored) return note

  // The record is behind the writing rather than the other way about, so the
  // record is brought into line. That covers a note whose name was the
  // placeholder every unnamed note used to wear -- left alone, it would have
  // gone on saying "Untitled note" in the picker and in the name an export
  // saves under until some edit silently replaced it. A real stored name is
  // never discarded merely because the writing begins with a heading: that
  // is exactly how an older note with a separate title and a headed body was
  // represented, and preserving both is the safe migration.
  if (!stored || stored === 'Untitled note') {
    const adopted: Note = { ...note, title: derived }
    await saveNote(adopted)
    return adopted
  }

  const named: Note = { ...note, content: `${markdownHeadingForText(stored)}\n\n${note.content}`, document: undefined }
  await saveNote(named)
  return named
}

interface NotesPanelRuntimeState {
  activeNote: Note | null
  dirty: boolean
  saveTimer: number | null
  /** The note's `content` is behind its `document` and must be derived again. */
  markdownStale: boolean
  /**
   * The panel's mounted editor and the note it holds. The note matters: for
   * a board after the panel is pointed at a different note, the editor
   * still standing here is the one for the note being left.
   */
  editor: { noteId: string, handle: NotesEditorHandle } | null
  /** A rename that arrived before the editor mounted, and the note it named. */
  pendingRename: { noteId: string; title: string } | null
}

const notesPanelRuntimeStates = new Map<string, NotesPanelRuntimeState>()

export function getNotesPanelRuntimeState(panelId: string): NotesPanelRuntimeState {
  const existing = notesPanelRuntimeStates.get(panelId)
  if (existing) return existing
  const created: NotesPanelRuntimeState = { activeNote: null, dirty: false, saveTimer: null, markdownStale: false, editor: null, pendingRename: null }
  notesPanelRuntimeStates.set(panelId, created)
  return created
}
