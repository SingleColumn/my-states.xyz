import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import { useValue, type Editor, type TLStoreSnapshot } from 'tldraw'
import type {
  CanvasCamera,
  Panel,
  PanelConfigs,
  PanelType,
  Board,
  BoardSummary,
} from './types'
import { downloadBoardArchive, duplicateBoard as duplicateStoredBoard, exportBoardArchive, importBoardArchive } from './boardArchive'
import { useAppearanceState, type AppearanceState } from './appearanceState'
import { nextDuplicateName } from './utils'
import { withRestoreWriteAccess } from './canvasRestore'
import { getPanelDefinition } from './panelRegistry'
import {
  createPanelShape,
  getPanel as getPanelFromEditor,
  listPanels,
  setPanelFocusView as writePanelFocusView,
  setPanelVisible as writePanelVisible,
  updatePanelConfig as writePanelConfig,
  type PanelWriteOptions,
} from './panelStore'
import { useBoardState } from './boardState'
import { getNotesPanelRuntimeState, useNotesState, type NotesState } from './notesState'
import { getSlideshowPanelRuntimeState, useSlideshowState, type SlideshowState } from './slideshowState'
import { useSpotifyState, type SpotifyState } from './spotifyState'

export type { NoteOpening } from './notesState'

interface BoardsState {
  isReady: boolean
  boards: BoardSummary[]
  activeBoard: Board | null
  error: string | null
  create(name: string): Promise<void>
  open(boardId: string): Promise<void>
  rename(name: string): Promise<void>
  /** Pins a theme to the active board; null returns it to the global theme. */
  setTheme(themeId: string | null): Promise<void>
  remove(boardId: string): Promise<void>
  /** A copy of the active board, named "<name> (copy)" or the next free number, opened once made. Never asks: the name is chosen to already be free. */
  duplicate(): Promise<void>
  exportActive(): Promise<void>
  /**
   * Resolves to a notice worth showing (a theme that came with the archive
   * was renamed), or null. `name`, when given, overrides the archive's own
   * name -- used to resolve a collision with an existing board's name in
   * the same step as the import, rather than importing under the colliding
   * name and asking for a separate rename afterward.
   */
  importFile(file: File, name?: string): Promise<string | null>
  /** The canvas has changed; this is the whole of what a board persists about it. */
  updateDocument(boardId: string, document: TLStoreSnapshot, camera: CanvasCamera): void
  /** Last successfully read/written board, including its document. React's activeBoard is not updated on every document save. */
  getActiveBoardRecord(): Board | null
  registerCanvasFlush(flush: () => void | Promise<void>): () => void
  registerCanvasPause(pause: (paused: boolean) => void): () => void
  registerCanvasRestore(prepare: (board: Board) => (() => void)): () => void
  isOperationPending(): boolean
  flush(): Promise<void>
}

/**
 * The panels on the canvas, read from and written to tldraw's store. The
 * store is the record of truth; this is the app's view of it and the one
 * place panel configuration is written from outside the canvas.
 */
export interface PanelsState {
  /** Every panel in stacking order, hidden ones included. Empty until the canvas is ready. */
  all: Panel[]
  /** True once the editor is attached and the active board has been restored into it. */
  isReady: boolean
  get(panelId: string): Panel | undefined
  updateConfig<Type extends PanelType>(panelId: string, patch: Partial<PanelConfigs[Type]>, options?: PanelWriteOptions): void
  setVisible(panelId: string, visible: boolean): void
  setFocusView(panelId: string, focusView: boolean): void
  /** Adds a panel of a kind at its default place. Null when the kind is a singleton that already exists, or the canvas is not ready. */
  add(type: PanelType): Panel | null
  /** Wired by the canvas: the editor to read and write through, and the board it has restored. */
  attachEditor(editor: Editor | null): void
  markRestored(boardId: string | null): void
}

export interface AppStateValue {
  boards: BoardsState
  panels: PanelsState
  notes: NotesState
  slideshow: SlideshowState
  spotify: SpotifyState
  appearance: AppearanceState
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const boardCore = useBoardState()
  const panels = usePanelsState(boardCore.activeBoard?.id ?? null)
  const notes = useNotesState(boardCore.activeBoard, panels, boardCore.operation)
  const slideshow = useSlideshowState(boardCore.activeBoard, panels)
  const spotify = useSpotifyState(boardCore.activeBoard, panels)
  const appearance = useAppearanceState(boardCore.activeBoard)

  const boards = useMemo<BoardsState>(
    () => ({
      isReady: boardCore.isReady,
      boards: boardCore.boards,
      activeBoard: boardCore.activeBoard,
      error: boardCore.error ?? notes.error,
      create: (name) => boardCore.operation.run(async () => {
        await notes.flush()
        await boardCore.flush()
        await boardCore.create(name)
      }),
      open: (boardId) => boardCore.operation.run(async () => {
        await notes.flush()
        await boardCore.flush()
        await boardCore.open(boardId)
      }),
      rename: (name) => boardCore.operation.run(() => boardCore.rename(name)),
      setTheme: (themeId) => boardCore.operation.run(() => boardCore.setTheme(themeId)),
      remove: (boardId) => boardCore.operation.run(async () => {
        await notes.flush()
        await boardCore.flush()
        await boardCore.remove(boardId)
      }),
      duplicate: () => boardCore.operation.run(async () => {
        const current = boardCore.activeBoard
        if (!current) throw new Error('No board is open.')
        await notes.flush()
        await boardCore.flush()
        const name = nextDuplicateName(current.name, boardCore.boards.map((summary) => summary.name))
        const duplicated = await duplicateStoredBoard(current.id, name)
        await boardCore.refreshSummaries()
        await boardCore.open(duplicated.id)
      }),
      exportActive: () => boardCore.operation.run(async () => {
        await notes.flush()
        if (!boardCore.activeBoard) throw new Error('No board is open.')
        await boardCore.flush()
        const blob = await exportBoardArchive(boardCore.activeBoard.id)
        downloadBoardArchive(blob, boardCore.activeBoard.name)
      }),
      importFile: (file, name) => boardCore.operation.run(async () => {
        await notes.flush()
        await boardCore.flush()
        const imported = await importBoardArchive(file)
        // The archive may have installed a theme; the library is read from
        // storage, so tell it. The picker likewise lists summaries; without
        // this the imported board is open but absent from the list until
        // the next create or delete.
        if (imported.theme) await appearance.refreshLibrary()
        await boardCore.refreshSummaries()
        await boardCore.open(imported.board.id)
        // A caller resolving a name collision renames within this same
        // operation, so the picker never shows the colliding name at all,
        // not even for the instant between two separate actions.
        if (name !== undefined && name !== imported.board.name) {
          await boardCore.rename(name)
          await boardCore.refreshSummaries()
        }
        return imported.theme?.outcome === 'renamed'
          ? `The theme "${imported.theme.name}" that came with this board was added under a new id because one with the same id was already installed.`
          : null
      }),
      updateDocument: boardCore.updateDocument,
      getActiveBoardRecord: boardCore.getActiveBoardRecord,
      registerCanvasFlush: boardCore.registerCanvasFlush,
      registerCanvasPause: (pause) => boardCore.operation.registerPause(pause),
      registerCanvasRestore: boardCore.registerCanvasRestore,
      isOperationPending: () => boardCore.operation.isBusy,
      flush: async () => {
        // Start both now: a lifecycle event must not wait for notes before
        // taking the canvas snapshot (the page may be leaving).
        await Promise.all([notes.flush(), boardCore.flush()])
      },
    }),
    [notes, boardCore, appearance],
  )

  const value = useMemo(() => ({ boards, panels, notes, slideshow, spotify, appearance }), [boards, panels, notes, slideshow, spotify, appearance])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState must be used inside AppStateProvider')
  return value
}

function usePanelsState(activeBoardId: string | null): PanelsState {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [restoredBoardId, setRestoredBoardId] = useState<string | null>(null)
  const isReady = editor !== null && restoredBoardId !== null && restoredBoardId === activeBoardId

  // Re-runs whenever a panel shape changes in the store. A drag changes a
  // shape's x/y but keeps its props object, and the view is cached on the
  // props, so a drag hands out the same Panel objects as before.
  const all = useValue('panels', () => (editor && isReady ? listPanels(editor) : []), [editor, isReady])

  return useMemo<PanelsState>(() => ({
    all,
    isReady,
    get: (panelId) => (editor ? getPanelFromEditor(editor, panelId) : undefined),
    // Readonly pauses tldraw's user tools, not a trusted app operation that
    // is completing while input is held (for example selecting a note).
    updateConfig: (panelId, patch, options) => { if (editor) withRestoreWriteAccess(editor, () => { writePanelConfig(editor, panelId, patch, options) }) },
    setVisible: (panelId, visible) => { if (editor) writePanelVisible(editor, panelId, visible) },
    setFocusView: (panelId, focusView) => { if (editor) writePanelFocusView(editor, panelId, focusView) },
    add: (type) => {
      if (!editor || !isReady) return null
      if (getPanelDefinition(type).singleton && listPanels(editor).some((panel) => panel.type === type)) return null
      const shape = createPanelShape(editor, type)
      return getPanelFromEditor(editor, shape.props.panelId) ?? null
    },
    attachEditor: setEditor,
    markRestored: setRestoredBoardId,
  }), [all, editor, isReady])
}

// This is the panel-scoped runtime seam used by the Notes implementation and acceptance tests.
// The Spotify and slideshow runtime seams remain intentionally unchanged in this turn.
export const panelRuntime = {
  notes: {
    forPanel: (panelId: string) => getNotesPanelRuntimeState(panelId) as unknown as Record<string, unknown>,
    update: (panelId: string, patch: Record<string, unknown>) => {
      const state = getNotesPanelRuntimeState(panelId)
      Object.assign(state, patch)
    },
  },
  slideshow: {
    forPanel: (panelId: string) => getSlideshowPanelRuntimeState(panelId) as unknown as Record<string, unknown>,
    update: (panelId: string, patch: Record<string, unknown>) => {
      const state = getSlideshowPanelRuntimeState(panelId)
      Object.assign(state, patch)
    },
  },
  restorePanel: (panelId: string) => getNotesPanelRuntimeState(panelId),
}
