import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useValue, type Editor, type TLStoreSnapshot } from 'tldraw'
import type {
  CanvasCamera,
  ImageItem,
  Note,
  Panel,
  PanelConfigs,
  PanelType,
  Moment,
  MomentSummary,
  SlideshowSettings,
  SpotifyPlaylistReference,
  SpotifyTokens,
  SpotifyTrackState,
} from './types'
import {
  clearDirectoryHandle,
  clearPanelDirectoryHandle,
  createMoment as createStoredMoment,
  defaultSlideshowSettings,
  defaultSpotifyPlaylistReference,
  deleteNote as deleteStoredNote,
  deleteMoment as deleteStoredMoment,
  getDirectoryHandle,
  getPanelDirectoryHandle,
  getNotes,
  getMoment,
  getMomentAssets,
  getMomentSummaries,
  initializeMoments,
  replaceMomentAssets,
  saveDirectoryHandle,
  savePanelDirectoryHandle,
  saveNote,
  renameMoment,
  saveMomentDocument,
  subscribeStorageStatus,
  saveSpotifyTokens,
  setActiveMomentId,
  momentLimits,
  loadSpotifyTokens,
} from './storage'
import { downloadMomentArchive, exportMomentArchive, importMomentArchive } from './momentArchive'
import { createId } from './utils'
import { SaveQueue } from './saveQueue'
import { persistNoteSnapshot } from './notePersistence'
import { MomentOperation } from './momentOperation'
import { withRestoreWriteAccess } from './canvasRestore'
import { createImageItemsFromBundledCollection } from './imageCollections'
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
import {
  releaseImageItems,
  settingsForBundledCollection,
  settingsForClearedImages,
  settingsForMomentAssets,
  statusForImageSource,
} from './slideshowSources'
import {
  exchangeSpotifyCode,
  getSpotifyPlaybackAction,
  mapPlaylist,
  mapTrack,
  parseSpotifyPlaylistUrl,
  refreshSpotifyToken,
  SpotifyPlaylistApiItem,
  SpotifyPlaylistSummary,
  SpotifyAuthenticationError,
  SpotifyTrackApiItem,
  SpotifyTrackSummary,
  spotifyFetch,
  startSpotifyLogin,
} from './spotify'

const supportedImagePattern = /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i

interface NotesState {
  notes: Note[]
  error: string | null
  setActiveNoteContent(content: string, panelId: string): void
  setActiveNoteTitle(title: string, panelId: string): void
  createNote(panelId: string): Promise<void>
  selectNote(id: string, panelId: string): void
  deleteNote(id: string, panelId: string): Promise<void>
  flush(): Promise<void>
}

interface SlideshowState {
  settingsFor(panelId: string): SlideshowSettings
  /** The picture showing now. Playback position, not configuration: it lives with the timer and is written to the panel only when playback rests. */
  currentIndexFor(panelId: string): number
  imagesFor(panelId: string): ImageItem[]
  isPlayingFor(panelId: string): boolean
  statusFor(panelId: string): string
  errorFor(panelId: string): string | null
  selectFolder(panelId: string): Promise<boolean>
  importFiles(files: FileList | File[], panelId: string): Promise<void>
  selectBundledCollection(collectionId: string, panelId: string): Promise<void>
  resetFolder(panelId: string): Promise<void>
  restoreFolder(panelId: string): Promise<void>
  setIsPlaying(value: boolean, panelId?: string): void
  stop(panelId?: string): void
  next(panelId?: string): void
  previous(panelId?: string): void
  updateSettings(settings: Partial<SlideshowSettings>, panelId?: string): void
}

interface SpotifyState {
  tokens: SpotifyTokens | null
  playlists: SpotifyPlaylistSummary[]
  tracks: SpotifyTrackSummary[]
  track: SpotifyTrackState | null
  deviceId: string | null
  isReady: boolean
  status: string
  error: string | null
  login(): Promise<void>
  logout(): void
  clearSearchResults(): void
  handleCallback(code: string, state: string | null): Promise<void>
  searchPlaylists(query: string): Promise<void>
  searchTracks(query: string): Promise<void>
  loadPlaylistFromUrl(url: string, panelId?: string): Promise<void>
  playPlaylist(summary?: SpotifyPlaylistSummary, panelId?: string): Promise<void>
  playTrack(summary: SpotifyTrackSummary, panelId?: string): Promise<void>
  togglePlay(panelId?: string): Promise<void>
  previousTrack(): Promise<void>
  nextTrack(): Promise<void>
  setVolume(value: number): Promise<void>
  seek(positionMs: number): Promise<void>
}

interface MomentsState {
  isReady: boolean
  moments: MomentSummary[]
  activeMoment: Moment | null
  error: string | null
  create(name: string): Promise<void>
  open(momentId: string): Promise<void>
  rename(name: string): Promise<void>
  remove(momentId: string): Promise<void>
  exportActive(): Promise<void>
  importFile(file: File): Promise<void>
  /** The canvas has changed; this is the whole of what a moment persists about it. */
  updateDocument(momentId: string, document: TLStoreSnapshot, camera: CanvasCamera): void
  /** Last successfully read/written moment, including its document. React's activeMoment is not updated on every document save. */
  getActiveMomentRecord(): Moment | null
  registerCanvasFlush(flush: () => void | Promise<void>): () => void
  registerCanvasPause(pause: (paused: boolean) => void): () => void
  registerCanvasRestore(prepare: (moment: Moment) => (() => void)): () => void
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
  /** True once the editor is attached and the active moment has been restored into it. */
  isReady: boolean
  get(panelId: string): Panel | undefined
  updateConfig<Type extends PanelType>(panelId: string, patch: Partial<PanelConfigs[Type]>, options?: PanelWriteOptions): void
  setVisible(panelId: string, visible: boolean): void
  setFocusView(panelId: string, focusView: boolean): void
  /** Adds a panel of a kind at its default place. Null when the kind is a singleton that already exists, or the canvas is not ready. */
  add(type: PanelType): Panel | null
  /** Wired by the canvas: the editor to read and write through, and the moment it has restored. */
  attachEditor(editor: Editor | null): void
  markRestored(momentId: string | null): void
}

export interface AppStateValue {
  moments: MomentsState
  panels: PanelsState
  notes: NotesState
  slideshow: SlideshowState
  spotify: SpotifyState
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const momentCore = useMomentState()
  const panels = usePanelsState(momentCore.activeMoment?.id ?? null)
  const notes = useNotesState(momentCore.activeMoment, panels, momentCore.operation)
  const slideshow = useSlideshowState(momentCore.activeMoment, panels)
  const spotify = useSpotifyState(momentCore.activeMoment, panels)

  const moments = useMemo<MomentsState>(
    () => ({
      isReady: momentCore.isReady,
      moments: momentCore.moments,
      activeMoment: momentCore.activeMoment,
      error: momentCore.error ?? notes.error,
      create: (name) => momentCore.operation.run(async () => {
        await notes.flush()
        await momentCore.flush()
        await momentCore.create(name)
      }),
      open: (momentId) => momentCore.operation.run(async () => {
        await notes.flush()
        await momentCore.flush()
        await momentCore.open(momentId)
      }),
      rename: (name) => momentCore.operation.run(() => momentCore.rename(name)),
      remove: (momentId) => momentCore.operation.run(async () => {
        await notes.flush()
        await momentCore.flush()
        await momentCore.remove(momentId)
      }),
      exportActive: () => momentCore.operation.run(async () => {
        await notes.flush()
        if (!momentCore.activeMoment) throw new Error('No moment is open.')
        await momentCore.flush()
        const blob = await exportMomentArchive(momentCore.activeMoment.id)
        downloadMomentArchive(blob, momentCore.activeMoment.name)
      }),
      importFile: (file) => momentCore.operation.run(async () => {
        await notes.flush()
        await momentCore.flush()
        const imported = await importMomentArchive(file)
        await momentCore.open(imported.id)
      }),
      updateDocument: momentCore.updateDocument,
      getActiveMomentRecord: momentCore.getActiveMomentRecord,
      registerCanvasFlush: momentCore.registerCanvasFlush,
      registerCanvasPause: (pause) => momentCore.operation.registerPause(pause),
      registerCanvasRestore: momentCore.registerCanvasRestore,
      isOperationPending: () => momentCore.operation.isBusy,
      flush: async () => {
        // Start both now: a lifecycle event must not wait for notes before
        // taking the canvas snapshot (the page may be leaving).
        await Promise.all([notes.flush(), momentCore.flush()])
      },
    }),
    [notes, momentCore],
  )

  const value = useMemo(() => ({ moments, panels, notes, slideshow, spotify }), [moments, panels, notes, slideshow, spotify])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState must be used inside AppStateProvider')
  return value
}

function usePanelsState(activeMomentId: string | null): PanelsState {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [restoredMomentId, setRestoredMomentId] = useState<string | null>(null)
  const isReady = editor !== null && restoredMomentId !== null && restoredMomentId === activeMomentId

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
    markRestored: setRestoredMomentId,
  }), [all, editor, isReady])
}

function useMomentState() {
  const [moments, setMoments] = useState<MomentSummary[]>([])
  const [activeMoment, setActiveMoment] = useState<Moment | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeMomentRef = useRef<Moment | null>(null)
  const [saveQueue] = useState(() => new SaveQueue((caught) => setError(caught instanceof Error ? caught.message : 'Could not save the moment. Keep this tab open and try again.')))
  const [operation] = useState(() => new MomentOperation())
  const canvasFlushRef = useRef<(() => void | Promise<void>) | null>(null)
  const canvasRestoreRef = useRef<((moment: Moment) => (() => void)) | null>(null)

  const refreshSummaries = useCallback(async () => {
    setMoments(await getMomentSummaries())
  }, [])

  useEffect(() => subscribeStorageStatus((status) => { if (status) setError(status) }), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const initial = await initializeMoments()
        const moment = await getMoment(initial.activeMomentId)
        if (cancelled || !moment) return
        activeMomentRef.current = moment
        setActiveMoment(moment)
        setMoments((await getMomentSummaries()).map((item) => item))
        setError(null)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load your moments.')
      } finally {
        if (!cancelled) setIsReady(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const registerCanvasFlush = useCallback((flush: () => void | Promise<void>) => {
    canvasFlushRef.current = flush
    return () => {
      if (canvasFlushRef.current === flush) canvasFlushRef.current = null
    }
  }, [])

  const registerCanvasRestore = useCallback((prepare: (moment: Moment) => (() => void)) => {
    canvasRestoreRef.current = prepare
    return () => { if (canvasRestoreRef.current === prepare) canvasRestoreRef.current = null }
  }, [])

  const flush = useCallback(async () => {
    // Invoke synchronously so visibility/pagehide captures changes even if
    // tldraw has not delivered its animation-frame listener yet.
    const canvasFlush = canvasFlushRef.current?.()
    await canvasFlush
    await saveQueue.flush()
  }, [saveQueue])

  const loadMoment = useCallback(async (momentId: string, flushCurrent = true) => {
    const moment = await getMoment(momentId)
    if (!moment) throw new Error('The requested moment no longer exists.')
    const restore = canvasRestoreRef.current?.(moment)
    // Input is paused by the enclosing moment operation. Take one final
    // snapshot before committing the active preference and ref handoff.
    if (flushCurrent) await flush()
    await setActiveMomentId(momentId)
    activeMomentRef.current = moment
    // Finish the editor handoff while the operation still owns the input
    // pause, not in a later React effect after input has been released.
    restore?.()
    setActiveMoment(moment)
    setError(null)
  }, [flush])

  const open = useCallback(async (momentId: string) => {
    await flush()
    await loadMoment(momentId)
  }, [flush, loadMoment])

  const create = useCallback(async (name: string) => {
    const moment = await createStoredMoment(name)
    await refreshSummaries()
    await open(moment.id)
  }, [open, refreshSummaries])

  const rename = useCallback(async (name: string) => {
    const current = activeMomentRef.current
    if (!current) return
    saveQueue.enqueue(`name:${current.id}`, async () => {
      const saved = await renameMoment(current.id, name)
      if (activeMomentRef.current?.id === saved.id) {
        activeMomentRef.current = { ...activeMomentRef.current, name: saved.name, updatedAt: saved.updatedAt }
        setActiveMoment((active) => active?.id === saved.id ? { ...active, name: saved.name, updatedAt: saved.updatedAt } : active)
      }
    })
    await saveQueue.flush()
    await refreshSummaries()
  }, [refreshSummaries, saveQueue])

  const remove = useCallback(async (momentId: string) => {
    const removingActive = activeMomentRef.current?.id === momentId
    await deleteStoredMoment(momentId)
    if (removingActive) activeMomentRef.current = null
    const remaining = await getMomentSummaries()
    setMoments(remaining)
    if (!removingActive) return

    if (remaining[0]) {
      await loadMoment(remaining[0].id, false)
      return
    }

    const replacement = await createStoredMoment('My first moment')
    setMoments(await getMomentSummaries())
    await loadMoment(replacement.id, false)
  }, [loadMoment])

  // The document changes on every drag and every edit, so it is kept on the
  // ref and in the database and not in React state: nothing renders from it,
  // and a state update here would re-render every panel on each change.
  const updateDocument = useCallback((momentId: string, document: TLStoreSnapshot, camera: CanvasCamera) => {
    // A delayed listener from the outgoing canvas must not save into the
    // destination, or resurrect a moment the user has just removed.
    if (activeMomentRef.current?.id !== momentId) return
    saveQueue.enqueue(`document:${momentId}`, async () => {
      const saved = await saveMomentDocument(momentId, document, camera)
      // This ref describes committed storage, not an optimistic snapshot.
      // The queue retains unsaved snapshots independently for retry.
      if (activeMomentRef.current?.id === saved.id) activeMomentRef.current = saved
      setError(null)
    })
  }, [saveQueue])

  return {
    isReady,
    operation,
    moments,
    activeMoment,
    error,
    create,
    open,
    rename,
    remove,
    updateDocument,
    getActiveMomentRecord: () => activeMomentRef.current,
    registerCanvasFlush,
    registerCanvasRestore,
    flush,
  }
}

function useNotesState(moment: Moment | null, panels: PanelsState, operation: MomentOperation): NotesState {
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saveQueue] = useState(() => new SaveQueue((caught) => setError(caught instanceof Error ? caught.message : 'Could not save your note. Keep this tab open and try again.')))
  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const runNoteOperation = useCallback((work: () => Promise<void>) => operation.run(work).catch((caught) => {
    setError(caught instanceof Error ? caught.message : 'Could not finish the note operation. Your unsaved draft has been kept.')
    throw caught
  }), [operation])

  const persistPanelNote = useCallback(async (panelId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    const note = state.activeNote
    if (note && state.dirty) {
      // Each panel's draft needs its own acknowledgement, even when two
      // panels refer to the same note. Coalescing by note id loses one ack.
      saveQueue.enqueue(`${panelId}:${note.id}`, async () => {
        await persistNoteSnapshot(state, note, saveNote)
        setError(null)
      })
    }
    await saveQueue.flush()
  }, [saveQueue])

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

  // The loading boundary is the moment, once the canvas has restored it:
  // which note each Notes panel shows is read from the panels then.
  const loadKey = panels.isReady ? moment?.id ?? '' : ''
  useEffect(() => {
    let cancelled = false
    const momentId = loadKey
    const notePanels = panelsRef.current.all.filter((panel): panel is Panel<'notes'> => panel.type === 'notes')

    async function load() {
      await flush()
      if (cancelled) return
      for (const state of notesPanelRuntimeStates.values()) {
        state.activeNote = null
        state.dirty = false
        if (state.saveTimer !== null) window.clearTimeout(state.saveTimer)
        state.saveTimer = null
      }
      setNotes([])
      if (!momentId) return
      const storedNotes = await getNotes(momentId)
      if (cancelled) return
      setNotes(storedNotes)
      for (const panel of notePanels) {
        const selected = storedNotes.find((note) => note.id === panel.config.activeNoteId) ?? storedNotes[0] ?? null
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

  const createNote = useCallback((panelId: string) => runNoteOperation(async () => {
    if (!moment) return
    await flush(panelId)
    const now = Date.now()
    const note: Note = {
      id: createId('note'),
      sessionId: moment.id,
      title: 'Untitled note',
      content: '',
      createdAt: now,
      updatedAt: now,
    }
    await saveNote(note)
    const state = getNotesPanelRuntimeState(panelId)
    state.activeNote = note
    setNotes((current) => [note, ...current])
    panels.updateConfig<'notes'>(panelId, { activeNoteId: note.id })
  }), [panels, moment, flush, runNoteOperation])

  const selectNote = useCallback((id: string, panelId: string) => {
    const next = notes.find((note) => note.id === id)
    if (!next) return
    void runNoteOperation(async () => {
      await flush(panelId)
      getNotesPanelRuntimeState(panelId).activeNote = next
      panels.updateConfig<'notes'>(panelId, { activeNoteId: next.id })
    }).catch(() => {})
  }, [flush, notes, panels, runNoteOperation])

  const deleteNote = useCallback((id: string, panelId: string) => runNoteOperation(async () => {
    await flush(panelId)
    await deleteStoredNote(id)
    const nextNotes = notes.filter((note) => note.id !== id)
    setNotes(nextNotes)
    const state = getNotesPanelRuntimeState(panelId)
    if (state.activeNote?.id === id) {
      const next = nextNotes[0] ?? null
      state.activeNote = next
      panels.updateConfig<'notes'>(panelId, { activeNoteId: next?.id ?? null })
    }
  }), [flush, notes, panels, runNoteOperation])

  const setActiveNoteContent = useCallback((content: string, panelId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    const current = state.activeNote
    if (!current) return
    const next = { ...current, content, updatedAt: Date.now() }
    state.activeNote = next
    setNotes((currentNotes) => currentNotes.map((note) => note.id === next.id ? next : note))
    scheduleSave(panelId)
  }, [scheduleSave])

  const setActiveNoteTitle = useCallback((title: string, panelId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    const current = state.activeNote
    if (!current) return
    const next = { ...current, title, updatedAt: Date.now() }
    state.activeNote = next
    setNotes((currentNotes) => currentNotes.map((note) => note.id === next.id ? next : note))
    scheduleSave(panelId)
  }, [scheduleSave])

  return { notes, error, setActiveNoteContent, setActiveNoteTitle, createNote, selectNote, deleteNote, flush }
}

function useSlideshowState(moment: Moment | null, panels: PanelsState): SlideshowState {
  const [, rerender] = useState(0)
  const touch = useCallback(() => rerender((value) => value + 1), [])
  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const settingsOf = useCallback((panelId: string): SlideshowSettings => {
    const panel = panelsRef.current.get(panelId)
    return panel?.type === 'slideshow' ? panel.config : defaultSlideshowSettings
  }, [])
  const writeSettings = useCallback((panelId: string, patch: Partial<SlideshowSettings>, options?: PanelWriteOptions) => {
    panelsRef.current.updateConfig<'slideshow'>(panelId, patch, options)
  }, [])
  // The picture showing now is playback position, like whether the show is
  // running, and lives with the timer. It is written back to the panel only
  // when playback rests, so a running show never touches the store.
  const setCurrentIndex = useCallback((panelId: string, index: number, persist: boolean) => {
    getSlideshowPanelRuntimeState(panelId).currentIndex = index
    if (persist) writeSettings(panelId, { currentIndex: index }, { history: 'ignore' })
    touch()
  }, [touch, writeSettings])

  // The loading boundary is the moment, once the canvas has restored it.
  const loadKey = panels.isReady ? moment?.id ?? '' : ''
  // Which Images panels exist and where each takes its pictures from. A
  // panel that arrives later (undo of a delete, a copy, a command) or whose
  // source changes under it loads its pictures the same way one present at
  // the start does.
  const sourceSignature = panels.all
    .filter((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')
    .map((panel) => `${panel.id}=${imageSourceKey(panel.config.imageSource)}`)
    .join('|')
  useEffect(() => {
    let cancelled = false
    const slideshowPanels = loadKey ? panelsRef.current.all.filter((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow') : []
    const activeIds = new Set(slideshowPanels.map((panel) => panel.id))
    for (const [panelId, state] of slideshowPanelRuntimeStates) {
      if (!activeIds.has(panelId)) {
        if (state.timerId !== null) window.clearTimeout(state.timerId)
        releaseImageItems(state.images)
        slideshowPanelRuntimeStates.delete(panelId)
      }
    }
    const toLoad = slideshowPanels.filter((panel) => getSlideshowPanelRuntimeState(panel.id).sourceKey !== imageSourceKey(panel.config.imageSource))
    for (const panel of toLoad) {
      const state = getSlideshowPanelRuntimeState(panel.id)
      if (state.timerId !== null) window.clearTimeout(state.timerId)
      state.timerId = null
      state.isPlaying = false
      state.sourceKey = imageSourceKey(panel.config.imageSource)
      state.currentIndex = panel.config.currentIndex
      state.status = statusForImageSource(panel.config.imageSource, 0)
      state.error = null
      releaseImageItems(state.images)
      state.images = []
    }
    touch()

    async function loadPanel(panel: Panel<'slideshow'>) {
      const state = getSlideshowPanelRuntimeState(panel.id)
      try {
        const source = panel.config.imageSource
        if (source.type === 'none') {
          state.status = 'Choose your images or try a sample collection.'
          return
        }
        let nextImages: ImageItem[]
        if (source.type === 'bundled') {
          const loaded = await createImageItemsFromBundledCollection(source.collectionId)
          if (!loaded) {
            const message = `The sample collection "${source.collectionId}" is not available in this version.`
            state.status = message
            state.error = message
            return
          }
          nextImages = loaded
        } else {
          const assets = await getMomentAssets(moment!.id, panel.id)
          nextImages = await Promise.all(assets.map(createImageItemFromAsset))
          nextImages.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
        }
        if (cancelled) {
          releaseImageItems(nextImages)
          return
        }
        state.images = nextImages
        state.status = statusForImageSource(source, nextImages.length)
        if (state.currentIndex >= nextImages.length && state.currentIndex !== 0) setCurrentIndex(panel.id, 0, true)
        touch()
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : 'Could not load the images for this moment.'
          state.status = message
          state.error = message
          touch()
        }
      }
    }
    if (!loadKey) return () => { cancelled = true }
    for (const panel of toLoad) void loadPanel(panel)
    return () => { cancelled = true }
  }, [loadKey, sourceSignature, setCurrentIndex, touch])

  const schedulePanelAdvance = useCallback((panelId: string) => {
    const state = getSlideshowPanelRuntimeState(panelId)
    if (!state.isPlaying || state.timerId !== null) return

    const panel = panelsRef.current.get(panelId)
    if (panel?.type !== 'slideshow') {
      state.isPlaying = false
      return
    }

    state.timerId = window.setTimeout(() => {
      state.timerId = null
      const currentPanel = panelsRef.current.get(panelId)
      if (currentPanel?.type !== 'slideshow' || !state.isPlaying) return
      if (state.images.length) {
        setCurrentIndex(panelId, getNextImageIndex(state.currentIndex, state.images.length, currentPanel.config.shuffle), false)
      }
      schedulePanelAdvance(panelId)
    }, panel.config.intervalMs)
  }, [setCurrentIndex])

  const replaceImages = useCallback(async (files: FileList | File[], folderName: string, panelId: string) => {
    if (!moment) return
    const selected = Array.from(files).filter(isSupportedImageFile)
    if (selected.length > momentLimits.maxImageCount) throw new Error(`A moment can contain at most ${momentLimits.maxImageCount} images.`)
    const assets = await Promise.all(selected.map((file) => createMomentAsset(file, moment.id, panelId)))
    await replaceMomentAssets(moment.id, assets, panelId)
    const nextImages = await Promise.all(assets.map(createImageItemFromAsset))
    nextImages.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    const state = getSlideshowPanelRuntimeState(panelId)
    if (state.timerId !== null) window.clearTimeout(state.timerId)
    state.timerId = null
    state.isPlaying = false
    releaseImageItems(state.images)
    state.images = nextImages
    state.status = nextImages.length ? `${folderName} · ${nextImages.length} images` : 'No supported images were selected.'
    state.error = null
    state.currentIndex = 0
    const nextSettings = settingsForMomentAssets(settingsOf(panelId), folderName)
    state.sourceKey = imageSourceKey(nextSettings.imageSource)
    writeSettings(panelId, nextSettings)
    touch()
  }, [moment, settingsOf, touch, writeSettings])

  const loadImagesFromHandle = useCallback(async (handle: FileSystemDirectoryHandle, panelId: string) => {
    const files: File[] = []
    for await (const file of readImageFilesFromDirectory(handle)) files.push(file)
    await replaceImages(files, handle.name, panelId)
  }, [replaceImages])

  const selectFolder = useCallback(async (panelId: string) => {
    if (!moment) return false
    if (!window.showDirectoryPicker) {
      getSlideshowPanelRuntimeState(panelId).error = 'Folder selection is unavailable in this browser. Use the file picker instead.'
      touch()
      return false
    }
    try {
      const handle = await window.showDirectoryPicker()
      await savePanelDirectoryHandle(moment.id, panelId, handle)
      await loadImagesFromHandle(handle, panelId)
      return true
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return true
      const state = getSlideshowPanelRuntimeState(panelId)
      state.error = caught instanceof Error ? caught.message : 'Could not select the folder.'
      touch()
      return false
    }
  }, [loadImagesFromHandle, moment, touch])

  const selectBundledCollection = useCallback(async (collectionId: string, panelId: string) => {
    if (!moment) throw new Error('Open a moment before selecting images.')
    const state = getSlideshowPanelRuntimeState(panelId)
    try {
      const nextImages = await createImageItemsFromBundledCollection(collectionId)
      if (!nextImages) {
        const message = `The sample collection "${collectionId}" is not available in this version.`
        state.error = message
        state.status = message
        touch()
        return
      }
      if (state.timerId !== null) window.clearTimeout(state.timerId)
      state.timerId = null
      releaseImageItems(state.images)
      state.images = nextImages
      state.isPlaying = nextImages.length > 0
      const nextSettings = settingsForBundledCollection(settingsOf(panelId), collectionId)
      state.currentIndex = nextSettings.currentIndex
      state.sourceKey = imageSourceKey(nextSettings.imageSource)
      writeSettings(panelId, nextSettings)
      state.status = statusForImageSource(nextSettings.imageSource, nextImages.length)
      state.error = null
      if (state.isPlaying) schedulePanelAdvance(panelId)
      touch()
    } catch (caught) {
      state.error = caught instanceof Error ? caught.message : 'Could not load the sample collection.'
      touch()
    }
  }, [schedulePanelAdvance, moment, settingsOf, touch, writeSettings])

  const restoreFolder = useCallback(async (panelId: string) => {
    if (!moment) return
    const stored = await getPanelDirectoryHandle(moment.id, panelId) ?? await getDirectoryHandle(moment.id)
    if (!stored) return
    try {
      if (!(await ensureReadPermission(stored.handle))) {
        getSlideshowPanelRuntimeState(panelId).status = `Permission is needed to reopen ${stored.name}.`
        touch()
        return
      }
      await loadImagesFromHandle(stored.handle, panelId)
    } catch (caught) {
      getSlideshowPanelRuntimeState(panelId).error = caught instanceof Error ? caught.message : 'Could not reopen the image folder.'
      touch()
    }
  }, [loadImagesFromHandle, moment, touch])

  const resetFolder = useCallback(async (panelId: string) => {
    if (!moment) return
    const state = getSlideshowPanelRuntimeState(panelId)
    const current = settingsOf(panelId)
    if (state.timerId !== null) window.clearTimeout(state.timerId)
    state.timerId = null
    state.isPlaying = false
    state.currentIndex = 0
    if (current.imageSource.type === 'session-assets') {
      await replaceMomentAssets(moment.id, [], panelId)
      await clearPanelDirectoryHandle(moment.id, panelId)
      await clearDirectoryHandle(moment.id)
    }
    releaseImageItems(state.images)
    state.images = []
    state.status = 'Choose your images or try a sample collection.'
    state.error = null
    const cleared = settingsForClearedImages(current)
    state.sourceKey = imageSourceKey(cleared.imageSource)
    writeSettings(panelId, cleared)
    touch()
  }, [moment, settingsOf, touch, writeSettings])

  const stop = useCallback((panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    if (state.timerId !== null) window.clearTimeout(state.timerId)
    state.timerId = null
    state.isPlaying = false
    setCurrentIndex(panelId, 0, true)
  }, [setCurrentIndex])

  const next = useCallback((panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    setCurrentIndex(panelId, getNextImageIndex(state.currentIndex, state.images.length, settingsOf(panelId).shuffle), true)
  }, [setCurrentIndex, settingsOf])

  const previous = useCallback((panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    setCurrentIndex(panelId, state.images.length ? (state.currentIndex - 1 + state.images.length) % state.images.length : 0, true)
  }, [setCurrentIndex])

  const updateSettings = useCallback((partial: Partial<SlideshowSettings>, panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    if (partial.intervalMs !== undefined && state.timerId !== null) {
      window.clearTimeout(state.timerId)
      state.timerId = null
    }
    const { currentIndex, ...configuration } = partial
    if (currentIndex !== undefined) setCurrentIndex(panelId, currentIndex, true)
    if (Object.keys(configuration).length) writeSettings(panelId, configuration)
    if (partial.intervalMs !== undefined && state.isPlaying) schedulePanelAdvance(panelId)
  }, [schedulePanelAdvance, setCurrentIndex, writeSettings])

  return {
    settingsFor: (panelId) => settingsOf(panelId),
    currentIndexFor: (panelId) => getSlideshowPanelRuntimeState(panelId).currentIndex,
    imagesFor: (panelId) => getSlideshowPanelRuntimeState(panelId).images,
    isPlayingFor: (panelId) => getSlideshowPanelRuntimeState(panelId).isPlaying,
    statusFor: (panelId) => getSlideshowPanelRuntimeState(panelId).status,
    errorFor: (panelId) => getSlideshowPanelRuntimeState(panelId).error,
    selectFolder,
    selectBundledCollection,
    importFiles: (files, panelId) => replaceImages(files, 'Imported images', panelId),
    resetFolder,
    restoreFolder,
    setIsPlaying: (value, panelId) => {
      if (!panelId) return
      const state = getSlideshowPanelRuntimeState(panelId)
      state.isPlaying = value
      if (value) schedulePanelAdvance(panelId)
      else {
        if (state.timerId !== null) {
          window.clearTimeout(state.timerId)
          state.timerId = null
        }
        // Playback has come to rest: this is where the picture showing is kept.
        setCurrentIndex(panelId, state.currentIndex, true)
      }
      touch()
    },
    stop, next, previous, updateSettings,
  }
}

function useSpotifyState(moment: Moment | null, panels: PanelsState): SpotifyState {
  const [tokens, setTokens] = useState<SpotifyTokens | null>(loadSpotifyTokens)
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([])
  const [tracks, setTracks] = useState<SpotifyTrackSummary[]>([])
  const [track, setTrack] = useState<SpotifyTrackState | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [status, setStatus] = useState('Log in to Spotify to play a playlist.')
  const [error, setError] = useState<string | null>(null)
  const playerRef = useRef<Spotify.Player | null>(null)
  const tokensRef = useRef(tokens)

  useEffect(() => {
    tokensRef.current = tokens
  }, [tokens])

  useEffect(() => {
    setPlaylists([])
    setTracks([])
    setTrack(null)
  }, [moment?.id])

  useEffect(() => {
    saveSpotifyTokens(tokens)
  }, [tokens])

  const endExpiredSession = useCallback(() => {
    playerRef.current?.disconnect()
    playerRef.current = null
    setTokens(null)
    setDeviceId(null)
    setIsReady(false)
    setTrack(null)
    setStatus('Your Spotify session has expired. Log in again to continue playback.')
    setError(null)
  }, [])

  const ensureFreshTokens = useCallback(async () => {
    if (!tokens) throw new Error('Log in to Spotify first.')
    if (tokens.expiresAt - Date.now() > 60_000) return tokens
    try {
      const refreshed = await refreshSpotifyToken(tokens)
      if (refreshed.expiresAt <= Date.now()) throw new Error('Spotify session has expired.')
      setTokens(refreshed)
      return refreshed
    } catch {
      endExpiredSession()
      throw new Error('Your Spotify session has expired. Log in again to continue playback.')
    }
  }, [endExpiredSession, tokens])

  const requestSpotify = useCallback(async <T,>(request: () => Promise<T>) => {
    try {
      return await request()
    } catch (caught) {
      if (caught instanceof SpotifyAuthenticationError) {
        endExpiredSession()
        throw new Error('Your Spotify session has expired. Log in again to continue playback.')
      }
      throw caught
    }
  }, [endExpiredSession])

  useEffect(() => {
    if (!tokens?.accessToken || playerRef.current) return
    let cancelled = false
    async function initPlayer() {
      try {
        await loadSpotifySdk()
        if (cancelled || !window.Spotify || !tokens?.accessToken) return
        const player = new window.Spotify.Player({ name: 'Music Images Canvas', getOAuthToken: (callback) => callback(tokensRef.current?.accessToken ?? ''), volume: 0.7 })
        player.addListener('ready', ({ device_id }) => {
          setDeviceId(device_id)
          setIsReady(true)
          setStatus('Spotify browser device is ready.')
          setError(null)
        })
        player.addListener('not_ready', () => {
          setIsReady(false)
          setStatus('Spotify browser device is offline.')
        })
        player.addListener('player_state_changed', (state) => {
          if (!state) return
          const current = state.track_window.current_track
          setTrack({ title: current.name, artist: current.artists.map((artist) => artist.name).join(', '), album: current.album.name, albumArt: current.album.images[0]?.url ?? null, url: spotifyUrlFromUri(current.uri), durationMs: state.duration, positionMs: state.position, paused: state.paused })
        })
        const handleError = (event: Spotify.WebPlaybackError) => {
          setError(event.message)
          setStatus('Spotify playback needs attention.')
        }
        player.addListener('initialization_error', handleError)
        player.addListener('authentication_error', endExpiredSession)
        player.addListener('account_error', handleError)
        player.addListener('playback_error', handleError)
        playerRef.current = player
        await player.connect()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not initialize Spotify.')
      }
    }
    void initPlayer()
    return () => {
      cancelled = true
    }
  }, [endExpiredSession, tokens?.accessToken])

  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const spotifyPanel = panels.all.find((panel): panel is Panel<'spotify'> => panel.type === 'spotify')
  // The user chose the playlist: history. The app filling in artwork it
  // looked up: not history, or Undo would take the picture away again.
  const setMomentPlaylist = useCallback((next: SpotifyPlaylistReference, panelId?: string, options?: PanelWriteOptions) => {
    const current = panelsRef.current
    const panel = (panelId ? current.get(panelId) : undefined) ?? current.all.find((candidate) => candidate.type === 'spotify')
    if (panel?.type === 'spotify') current.updateConfig<'spotify'>(panel.id, { playlist: next }, options)
  }, [])

  // A playlist saved before the panel showed artwork - or restored from an
  // exported moment - has a name but no image. Look the artwork up once so the
  // panel can still show which playlist is loaded.
  const savedPlaylist = spotifyPanel?.config.playlist
  const playlistMissingArtwork = savedPlaylist?.id && !savedPlaylist.image ? savedPlaylist.id : null
  const artworkLookupsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!playlistMissingArtwork || !tokens || artworkLookupsRef.current.has(playlistMissingArtwork)) return
    artworkLookupsRef.current.add(playlistMissingArtwork)
    let cancelled = false
    void (async () => {
      try {
        const fresh = await ensureFreshTokens()
        const summary = mapPlaylist(await spotifyFetch<SpotifyPlaylistApiItem>(`/playlists/${playlistMissingArtwork}`, fresh.accessToken))
        if (cancelled || !summary.image) return
        setMomentPlaylist({ id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image }, undefined, { history: 'ignore' })
      } catch {
        // Artwork is decoration: a failed lookup must not interrupt playback.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ensureFreshTokens, playlistMissingArtwork, setMomentPlaylist, tokens])

  const login = useCallback(async () => startSpotifyLogin(), [])
  const clearSearchResults = useCallback(() => {
    setPlaylists([])
    setTracks([])
  }, [])
  const logout = useCallback(() => {
    playerRef.current?.disconnect()
    playerRef.current = null
    setTokens(null)
    setDeviceId(null)
    setIsReady(false)
    setTrack(null)
    setStatus('Logged out of Spotify.')
  }, [])
  const handleCallback = useCallback(async (code: string, state: string | null) => {
    setTokens(await exchangeSpotifyCode(code, state))
    setStatus('Spotify login complete.')
    setError(null)
  }, [])

  const searchPlaylists = useCallback(async (query: string) => {
    const fresh = await ensureFreshTokens()
    if (!query.trim()) {
      setPlaylists([])
      return
    }
    const result = await requestSpotify(() => spotifyFetch<{ playlists: { next: string | null; items: Array<SpotifyPlaylistApiItem | null> } }>(`/search?${new URLSearchParams({ q: query, type: 'playlist', limit: '10', offset: '0' }).toString()}`, fresh.accessToken))
    const items = [...result.playlists.items]
    let next = result.playlists.next
    for (let offset = 10; next && offset < 50; offset += 10) {
      const page = await requestSpotify(() => spotifyFetch<{ playlists: { next: string | null; items: Array<SpotifyPlaylistApiItem | null> } }>(`/search?${new URLSearchParams({ q: query, type: 'playlist', limit: '10', offset: String(offset) }).toString()}`, fresh.accessToken))
      items.push(...page.playlists.items)
      next = page.playlists.next
    }
    const mapped = items.filter(isSpotifyPlaylistApiItem).map(mapPlaylist)
    setPlaylists([...new Map(mapped.map((item) => [item.id, item])).values()])
    setError(null)
  }, [ensureFreshTokens, requestSpotify])

  const searchTracks = useCallback(async (query: string) => {
    const trimmed = query.trim()
    if (!trimmed) {
      setTracks([])
      return
    }
    const fresh = await ensureFreshTokens()
    const result = await requestSpotify(() => spotifyFetch<{ tracks: { items: Array<SpotifyTrackApiItem | null> } }>(
      `/search?${new URLSearchParams({ q: buildTrackSearchQuery(trimmed), type: 'track', limit: '10' }).toString()}`,
      fresh.accessToken,
    ))
    const mapped = result.tracks.items.filter(isSpotifyTrackApiItem).map(mapTrack)
    setTracks(rankTracks(mapped, trimmed))
    setError(null)
  }, [ensureFreshTokens, requestSpotify])

  const loadPlaylistFromUrl = useCallback(async (url: string, panelId?: string) => {
    const id = parseSpotifyPlaylistUrl(url)
    if (!id) throw new Error('Paste a valid Spotify playlist URL or URI.')
    const fresh = await ensureFreshTokens()
    const item = await requestSpotify(() => spotifyFetch<SpotifyPlaylistApiItem>(`/playlists/${id}`, fresh.accessToken))
    const summary = mapPlaylist(item)
    const selected = { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image }
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ context_uri: selected.uri }) }))
    setMomentPlaylist(selected, panelId)
    setPlaylists((current) => [summary, ...current.filter((candidate) => candidate.id !== summary.id)])
    setStatus(`Playing ${summary.name}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify, setMomentPlaylist])

  const playPlaylist = useCallback(async (summary?: SpotifyPlaylistSummary, panelId?: string) => {
    const panelPlaylist = (panelId ? panels.get(panelId) : undefined)?.type === 'spotify' ? (panels.get(panelId!) as Panel<'spotify'>).config.playlist : undefined
    const selected = summary ? { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image } : panelPlaylist ?? defaultSpotifyPlaylistReference
    if (!selected.uri) throw new Error('Choose a playlist first.')
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ context_uri: selected.uri }) }))
    setMomentPlaylist(selected, panelId)
    setStatus(`Playing ${selected.name ?? 'playlist'}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify, panels, setMomentPlaylist])

  const playTrack = useCallback(async (summary: SpotifyTrackSummary, _panelId?: string) => {
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ uris: [summary.uri] }) }))
    setStatus(`Playing ${summary.name} by ${summary.artists}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify])

  const togglePlay = useCallback(async (panelId?: string) => {
    const panelPlaylist = (panelId ? panels.get(panelId) : undefined)?.type === 'spotify' ? (panels.get(panelId!) as Panel<'spotify'>).config.playlist : undefined
    const selectedPlaylist = panelPlaylist ?? defaultSpotifyPlaylistReference
    const action = getSpotifyPlaybackAction(Boolean(track), selectedPlaylist.uri)
    if (action === 'load-saved-playlist') {
      await playPlaylist(undefined, panelId)
      return
    }
    if (action === 'missing-playlist') {
      throw new Error('Load or choose a playlist before starting playback.')
    }

    const player = playerRef.current
    if (!player) throw new Error('Spotify browser device is not ready yet.')
    await player.togglePlay()
  }, [playPlaylist, panels, track])

  return {
    tokens, playlists, tracks, track, deviceId, isReady, status, error, login, logout, clearSearchResults, handleCallback, searchPlaylists, searchTracks, loadPlaylistFromUrl, playPlaylist, playTrack,
    togglePlay,
    previousTrack: async () => playerRef.current?.previousTrack(),
    nextTrack: async () => playerRef.current?.nextTrack(),
    setVolume: async (value) => playerRef.current?.setVolume(value),
    seek: async (positionMs) => playerRef.current?.seek(positionMs),
  }
}

interface NotesPanelRuntimeState {
  activeNote: Note | null
  dirty: boolean
  saveTimer: number | null
}

interface SlideshowPanelRuntimeState {
  images: ImageItem[]
  isPlaying: boolean
  currentIndex: number
  /** The image source the loaded pictures came from, so a changed source reloads and an unchanged one does not. */
  sourceKey: string | null
  timerId: number | null
  status: string
  error: string | null
}

const notesPanelRuntimeStates = new Map<string, NotesPanelRuntimeState>()
const slideshowPanelRuntimeStates = new Map<string, SlideshowPanelRuntimeState>()
function getNotesPanelRuntimeState(panelId: string): NotesPanelRuntimeState {
  const existing = notesPanelRuntimeStates.get(panelId)
  if (existing) return existing
  const created: NotesPanelRuntimeState = { activeNote: null, dirty: false, saveTimer: null }
  notesPanelRuntimeStates.set(panelId, created)
  return created
}

function imageSourceKey(source: SlideshowSettings['imageSource']) {
  return source.type === 'bundled' ? `bundled:${source.collectionId}` : source.type
}

function getSlideshowPanelRuntimeState(panelId: string): SlideshowPanelRuntimeState {
  const existing = slideshowPanelRuntimeStates.get(panelId)
  if (existing) return existing
  const created: SlideshowPanelRuntimeState = {
    images: [],
    isPlaying: false,
    currentIndex: 0,
    sourceKey: null,
    timerId: null,
    status: 'Choose your images or try a sample collection.',
    error: null,
  }
  slideshowPanelRuntimeStates.set(panelId, created)
  return created
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

function spotifyUrlFromUri(uri?: string) {
  const match = uri?.match(/^spotify:(track|episode):([A-Za-z0-9]+)$/)
  return match ? `https://open.spotify.com/${match[1]}/${match[2]}` : null
}

function isSpotifyTrackApiItem(item: SpotifyTrackApiItem | null): item is SpotifyTrackApiItem {
  return Boolean(item?.id && item.name && item.uri)
}

function buildTrackSearchQuery(query: string) {
  const parts = query.split(/\s+-\s+|\s+by\s+/i)
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return query
  return `track:${parts[0].trim()} artist:${parts[1].trim()}`
}

function rankTracks(tracks: SpotifyTrackSummary[], query: string) {
  const normalisedQuery = normaliseSearchText(query)
  const [title, artist] = query.split(/\s+-\s+|\s+by\s+/i).map(normaliseSearchText)
  return [...tracks].sort((left, right) => scoreTrack(right) - scoreTrack(left))

  function scoreTrack(track: SpotifyTrackSummary) {
    const trackTitle = normaliseSearchText(track.name)
    const trackArtist = normaliseSearchText(track.artists)
    const combined = `${trackTitle} ${trackArtist}`
    let score = 0
    if (combined === normalisedQuery) score += 1000
    if (trackTitle === normalisedQuery) score += 800
    if (title && trackTitle === title) score += 700
    if (artist && trackArtist.includes(artist)) score += 500
    if (combined.includes(normalisedQuery)) score += 300
    score += normalisedQuery.split(' ').filter((word) => combined.includes(word)).length * 10
    return score
  }
}

function normaliseSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

async function ensureReadPermission(handle: FileSystemDirectoryHandle) {
  const descriptor = { mode: 'read' as const }
  if (!handle.queryPermission || !handle.requestPermission) return true
  if ((await handle.queryPermission(descriptor)) === 'granted') return true
  return (await handle.requestPermission(descriptor)) === 'granted'
}

function getNextImageIndex(currentIndex: number, length: number, shuffle: boolean) {
  if (length <= 0) return 0
  if (!shuffle || length === 1) return (currentIndex + 1) % length
  let next = Math.floor(Math.random() * length)
  if (next === currentIndex) next = (next + 1) % length
  return next
}

function isSupportedImageFile(file: File) {
  return file.type.startsWith('image/') || supportedImagePattern.test(file.name)
}

async function createMomentAsset(file: File, momentId: string, panelId?: string) {
  if (file.size > momentLimits.maxImageBytes) throw new Error(`${file.name} exceeds the 25 MB per-image limit.`)
  const mimeType = normaliseImageMimeType(file)
  if (!mimeType) throw new Error(`${file.name} is not a supported image type.`)
  const url = URL.createObjectURL(file)
  const dimensions = await readImageDimensions(url)
  URL.revokeObjectURL(url)
  return {
    id: createId('image'),
    sessionId: momentId,
    ...(panelId ? { panelId } : {}),
    filename: file.name,
    name: file.webkitRelativePath || file.name,
    mimeType,
    size: file.size,
    lastModified: file.lastModified,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    blob: file,
  }
}

async function createImageItemFromAsset(asset: Awaited<ReturnType<typeof getMomentAssets>>[number]) {
  const url = URL.createObjectURL(asset.blob)
  return { ...asset, url, urlKind: 'object-url' as const }
}

function normaliseImageMimeType(file: File) {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/svg+xml'].includes(file.type)) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' } as Record<string, string | undefined>)[extension ?? '']
}

async function readImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    return null
  }
  if (!image.naturalWidth || !image.naturalHeight) return null
  return { width: image.naturalWidth, height: image.naturalHeight }
}

async function* readImageFilesFromDirectory(handle: FileSystemDirectoryHandle): AsyncGenerator<File> {
  for await (const [, entry] of handle.entries()) {
    if (entry.kind === 'file') yield entry.getFile()
    else yield* readImageFilesFromDirectory(entry)
  }
}

function loadSpotifySdk() {
  if (window.Spotify) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://sdk.scdn.co/spotify-player.js"]')
    if (existing) {
      window.onSpotifyWebPlaybackSDKReady = () => resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    script.onerror = () => reject(new Error('Spotify Web Playback SDK could not be loaded.'))
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    document.body.appendChild(script)
  })
}

function isSpotifyPlaylistApiItem(item: SpotifyPlaylistApiItem | null): item is SpotifyPlaylistApiItem {
  return Boolean(item?.id && item.name && item.uri)
}
