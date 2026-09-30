import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useValue, type Editor, type TLStoreSnapshot } from 'tldraw'
import type {
  CanvasCamera,
  ImageItem,
  Note,
  NoteDocument,
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
  clearPanelDirectoryHandle,
  createMoment as createStoredMoment,
  defaultSlideshowSettings,
  defaultSpotifyPlaylistReference,
  deleteNote as deleteStoredNote,
  deleteMoment as deleteStoredMoment,
  getPanelDirectoryHandle,
  getNotes,
  getMoment,
  getMomentAssets,
  getMomentSummaries,
  initializeMoments,
  replaceMomentAssets,
  savePanelDirectoryHandle,
  saveNote,
  renameMoment,
  saveMomentDocument,
  setMomentTheme,
  subscribeStorageStatus,
  saveSpotifyTokens,
  setActiveMomentId,
  momentLimits,
  loadSpotifyTokens,
} from './storage'
import { downloadMomentArchive, duplicateMoment as duplicateStoredMoment, exportMomentArchive, importMomentArchive } from './momentArchive'
import { useAppearanceState, type AppearanceState } from './appearanceState'
import { createId, nextDuplicateName } from './utils'
import { SaveQueue } from './saveQueue'
import { persistNoteSnapshot } from './notePersistence'
import { MomentOperation } from './momentOperation'
import { withRestoreWriteAccess } from './canvasRestore'
import { createImageItemsFromBundledCollection } from './imageCollections'
import type { NotesEditorHandle } from './panels/NotesEditor'
import { getPanelDefinition } from './panelRegistry'
import { markdownHeadingForText, noteTitleFromMarkdown } from './noteTitle'
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
  isFolderPickerCancelledByUser,
  releaseImageItems,
  settingsForBundledCollection,
  settingsForClearedImages,
  settingsForMomentAssets,
  statusForImageSource,
} from './slideshowSources'
import {
  exchangeSpotifyCode,
  getSpotifyPlaybackAction,
  isSpotifyPlaylistApiItem,
  isSpotifyTrackApiItem,
  mapPlaylist,
  mapTrack,
  parseSpotifyPlaylistUrl,
  refreshSpotifyToken,
  SpotifyPlaylistApiItem,
  SpotifyPlaylistSearchResult,
  SpotifyPlaylistSummary,
  SpotifyAuthenticationError,
  SpotifyTrackApiItem,
  SpotifyTrackSearchResult,
  SpotifyTrackSummary,
  spotifyFetch,
  startSpotifyLogin,
} from './spotify'
import { fetchCuratedPlaylists, searchCatalogPlaylists, searchCatalogTracks } from './spotifyCatalog'

const supportedImagePattern = /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i

/** A note's starting title and Markdown, when it does not start empty. */
export interface NoteOpening {
  title: string
  content: string
}

interface NotesState {
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

interface SlideshowState {
  settingsFor(panelId: string): SlideshowSettings
  /** The picture showing now. Playback position, not configuration: it lives with the timer and is written to the panel only when playback rests. */
  currentIndexFor(panelId: string): number
  imagesFor(panelId: string): ImageItem[]
  isPlayingFor(panelId: string): boolean
  statusFor(panelId: string): string
  errorFor(panelId: string): string | null
  selectFolder(panelId: string): Promise<'selected' | 'cancelled' | 'fallback'>
  importFiles(files: FileList | File[], panelId: string): Promise<void>
  selectBundledCollection(collectionId: string, panelId: string): Promise<boolean>
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
  /**
   * A song someone picked out of the results without playing it. Runtime
   * only, and never part of a moment: a moment remembers a playlist, which
   * is what the panel is for, and a chosen song is a step on the way to one
   * rather than something to reopen a moment on.
   */
  selectedTrack: SpotifyTrackSummary | null
  deviceId: string | null
  isReady: boolean
  status: string
  error: string | null
  login(): Promise<void>
  logout(): void
  clearSearchResults(): void
  handleCallback(code: string, state: string | null): Promise<void>
  /**
   * True once a sign-in that left for Spotify has come back without succeeding:
   * cancelled there, refused, or its code could not be exchanged. The panel uses
   * it to give back what the visitor was doing, which a success gives back by
   * another route.
   */
  signInFailed: boolean
  /** For the ways a callback fails before there is a code to exchange. */
  reportSignInFailure(): void
  playlistsHaveMore: boolean
  loadMorePlaylists(): Promise<void>
  searchPlaylists(query: string): Promise<void>
  searchTracks(query: string): Promise<void>
  loadPlaylistFromUrl(url: string, panelId?: string): Promise<void>
  /**
   * Makes a playlist the panel's loaded one without playing it. Choosing and
   * playing are two things: someone browsing before they have connected
   * Spotify can do the first, and only the second needs their account.
   */
  selectPlaylist(summary: SpotifyPlaylistSummary, panelId?: string): void
  selectTrack(summary: SpotifyTrackSummary | null): void
  /** Reads one song's public details by id — how a song chosen before connecting is found again afterwards. */
  lookupTrack(trackId: string): Promise<void>
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
  /** Pins a theme to the active moment; null returns it to the global theme. */
  setTheme(themeId: string | null): Promise<void>
  remove(momentId: string): Promise<void>
  /** A copy of the active moment, named "<name> (copy)" or the next free number, opened once made. Never asks: the name is chosen to already be free. */
  duplicate(): Promise<void>
  exportActive(): Promise<void>
  /**
   * Resolves to a notice worth showing (a theme that came with the archive
   * was renamed), or null. `name`, when given, overrides the archive's own
   * name -- used to resolve a collision with an existing moment's name in
   * the same step as the import, rather than importing under the colliding
   * name and asking for a separate rename afterward.
   */
  importFile(file: File, name?: string): Promise<string | null>
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
  appearance: AppearanceState
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const momentCore = useMomentState()
  const panels = usePanelsState(momentCore.activeMoment?.id ?? null)
  const notes = useNotesState(momentCore.activeMoment, panels, momentCore.operation)
  const slideshow = useSlideshowState(momentCore.activeMoment, panels)
  const spotify = useSpotifyState(momentCore.activeMoment, panels)
  const appearance = useAppearanceState(momentCore.activeMoment)

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
      setTheme: (themeId) => momentCore.operation.run(() => momentCore.setTheme(themeId)),
      remove: (momentId) => momentCore.operation.run(async () => {
        await notes.flush()
        await momentCore.flush()
        await momentCore.remove(momentId)
      }),
      duplicate: () => momentCore.operation.run(async () => {
        const current = momentCore.activeMoment
        if (!current) throw new Error('No moment is open.')
        await notes.flush()
        await momentCore.flush()
        const name = nextDuplicateName(current.name, momentCore.moments.map((summary) => summary.name))
        const duplicated = await duplicateStoredMoment(current.id, name)
        await momentCore.refreshSummaries()
        await momentCore.open(duplicated.id)
      }),
      exportActive: () => momentCore.operation.run(async () => {
        await notes.flush()
        if (!momentCore.activeMoment) throw new Error('No moment is open.')
        await momentCore.flush()
        const blob = await exportMomentArchive(momentCore.activeMoment.id)
        downloadMomentArchive(blob, momentCore.activeMoment.name)
      }),
      importFile: (file, name) => momentCore.operation.run(async () => {
        await notes.flush()
        await momentCore.flush()
        const imported = await importMomentArchive(file)
        // The archive may have installed a theme; the library is read from
        // storage, so tell it. The picker likewise lists summaries; without
        // this the imported moment is open but absent from the list until
        // the next create or delete.
        if (imported.theme) await appearance.refreshLibrary()
        await momentCore.refreshSummaries()
        await momentCore.open(imported.moment.id)
        // A caller resolving a name collision renames within this same
        // operation, so the picker never shows the colliding name at all,
        // not even for the instant between two separate actions.
        if (name !== undefined && name !== imported.moment.name) {
          await momentCore.rename(name)
          await momentCore.refreshSummaries()
        }
        return imported.theme?.outcome === 'renamed'
          ? `The theme "${imported.theme.name}" that came with this moment was added under a new id because one with the same id was already installed.`
          : null
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
    [notes, momentCore, appearance],
  )

  const value = useMemo(() => ({ moments, panels, notes, slideshow, spotify, appearance }), [moments, panels, notes, slideshow, spotify, appearance])

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
        let summaries = await getMomentSummaries()
        if (cancelled) return
        let moment = await getMoment(initial.activeMomentId).catch(() => undefined)
        let openError: string | null = null
        // Listing is metadata-only and does not hit this, but opening the
        // remembered active moment can still fail (schema mismatch, for
        // instance). Fall back to another moment rather than stranding the
        // user on the loading screen with nothing to open; the unreadable
        // record is left untouched and stays listed for a build that can
        // read it.
        if (!moment) {
          openError = 'Your last-opened moment could not be read. Its stored data has not been changed.'
          for (const candidate of summaries) {
            if (candidate.id === initial.activeMomentId) continue
            moment = await getMoment(candidate.id).catch(() => undefined)
            if (cancelled) return
            if (moment) {
              await setActiveMomentId(candidate.id)
              break
            }
          }
        }
        if (!moment) {
          // Every stored moment failed to open, not only the active one (for
          // example, a schema version bump made all of them unreadable at
          // once): fall back exactly as if there were none, rather than
          // leaving nothing to open and no way to start one. Their records
          // are left untouched and stay listed.
          moment = await createStoredMoment('A new moment')
          if (cancelled) return
          summaries = await getMomentSummaries()
          await setActiveMomentId(moment.id)
          openError = summaries.length > 1 ? 'None of your saved moments could be opened by this version. A new one has been started; their stored data has not been changed.' : null
        }
        if (cancelled) return
        setMoments(summaries)
        activeMomentRef.current = moment
        setActiveMoment(moment)
        setError(openError)
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

  const setTheme = useCallback(async (themeId: string | null) => {
    const current = activeMomentRef.current
    if (!current) return
    saveQueue.enqueue(`theme:${current.id}`, async () => {
      const saved = await setMomentTheme(current.id, themeId)
      if (activeMomentRef.current?.id !== saved.id) return
      const { themeId: _previous, ...rest } = activeMomentRef.current
      activeMomentRef.current = { ...rest, ...(saved.themeId ? { themeId: saved.themeId } : {}), updatedAt: saved.updatedAt }
      setActiveMoment((active) => {
        if (active?.id !== saved.id) return active
        const { themeId: _stale, ...kept } = active
        return { ...kept, ...(saved.themeId ? { themeId: saved.themeId } : {}), updatedAt: saved.updatedAt }
      })
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

    const replacement = await createStoredMoment('A new moment')
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
    setTheme,
    remove,
    refreshSummaries,
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
  // Which moment `notes` actually holds loaded notes for. A moment switch
  // updates panels synchronously (tldraw's own store) but notes only once
  // this hook's async load effect below finishes, so between those two
  // points panelId can already name the new moment while `notes` still
  // holds the old one's. Set only at the moment load() actually replaces
  // `notes` with real data for `momentId` - never for the moment a switch
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
        state.markdownStale = false
        if (state.saveTimer !== null) window.clearTimeout(state.saveTimer)
        state.saveTimer = null
      }
      setNotes([])
      if (!momentId) return
      const storedNotes = await getNotes(momentId)
      if (cancelled) return
      // A moment with no notes yet (freshly created, or its last note just
      // removed) opens with a blank note already active, rather than
      // making the writer click through an empty state to start one.
      if (storedNotes.length === 0 && notePanels.length > 0) {
        const now = Date.now()
        // No name: a note is named by its first line, and nothing has been
        // written at the top of this one yet. Every list that shows it says
        // "Untitled note" in place of the empty name.
        const blank: Note = { id: createId('note'), momentId, title: '', content: '', createdAt: now, updatedAt: now }
        await saveNote(blank)
        if (cancelled) return
        setNotes([blank])
        notesLoadedForRef.current = momentId
        for (const panel of notePanels) {
          getNotesPanelRuntimeState(panel.id).activeNote = blank
          panelsRef.current.updateConfig<'notes'>(panel.id, { activeNoteId: blank.id })
        }
        return
      }
      const openedNotes = await Promise.all(storedNotes.map(withNameAsFirstLine))
      if (cancelled) return
      setNotes(openedNotes)
      notesLoadedForRef.current = momentId
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
   * with the lowest id, since an id carries the moment it was made in.
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
    if (!moment) return
    await flush(panelId)
    const now = Date.now()
    const openingTitle = opening ? noteTitleFromMarkdown(opening.content) : ''
    const fallbackHeading = opening && !openingTitle ? markdownHeadingForText(opening.title) : ''
    const content = fallbackHeading ? `${fallbackHeading}\n\n${opening!.content}` : opening?.content ?? ''
    const note: Note = {
      id: createId('note'),
      momentId: moment.id,
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
  }), [panels, moment, flush, runNoteOperation])

  const selectNote = useCallback((id: string, panelId: string) => {
    // notesLoadedForRef, not just membership: right after a moment switch,
    // panelId can already belong to the new moment while `notes` still
    // holds the old one's, and an old note's id would otherwise be found
    // "valid" and get written onto the new moment's panel.
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
    // deleteStoredNote deletes by id alone, with no moment to scope it to.
    // A stale or foreign id (retained across a moment switch, say) must
    // never reach it: it would permanently delete a note out of whichever
    // moment actually owns it, leaving that moment's own panels pointing
    // at a note that no longer exists - the same failure this function's
    // own redirect loop below exists to prevent, reached through a
    // different door. Mirrors the same check selectNote already makes -
    // gated on notesLoadedForRef too, not just membership in `notes`: a
    // panelId can already belong to a moment just switched into while
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
    // from on import (see the archive validation in momentArchive.ts).
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
    // still has the outgoing note's editor standing for a moment, and
    // renaming through that would write this name into the note being left.
    if (state.editor && state.editor.noteId === open.id) {
      state.editor.handle.setTitle(title)
      return
    }
    // The editor mounts a moment after the note is opened, and a command can
    // land inside that moment -- a script renaming a note it has just made,
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
  // What the note will call itself the moment it is opened. A first line
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
          state.status = 'Choose an image collection, or use the panel menu for a local folder.'
          return
        }
        let nextImages: ImageItem[]
        if (source.type === 'bundled') {
          const loaded = await createImageItemsFromBundledCollection(source.collectionId)
          if (!loaded) {
        const message = `The image collection "${source.collectionId}" is not available in this version.`
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
    if (!moment) return 'fallback' as const
    if (!window.showDirectoryPicker) {
      getSlideshowPanelRuntimeState(panelId).error = 'Folder selection is unavailable in this browser. Use the file picker instead.'
      touch()
      return 'fallback' as const
    }
    const openedAt = performance.now()
    try {
      const handle = await window.showDirectoryPicker()
      await savePanelDirectoryHandle(moment.id, panelId, handle)
      await loadImagesFromHandle(handle, panelId)
      return 'selected' as const
    } catch (caught) {
      // A genuine cancel is the end of it. An abort that arrives before a
      // dialog could have appeared means this browser never showed one, and
      // the caller should offer the file input instead.
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        return isFolderPickerCancelledByUser(caught, performance.now() - openedAt) ? 'cancelled' as const : 'fallback' as const
      }
      const state = getSlideshowPanelRuntimeState(panelId)
      state.error = caught instanceof Error ? caught.message : 'Could not select the folder.'
      touch()
      return 'fallback' as const
    }
  }, [loadImagesFromHandle, moment, touch])

  const selectBundledCollection = useCallback(async (collectionId: string, panelId: string) => {
    if (!moment) throw new Error('Open a moment before selecting images.')
    const state = getSlideshowPanelRuntimeState(panelId)
    try {
      const nextImages = await createImageItemsFromBundledCollection(collectionId)
      if (!nextImages) {
        const message = `The image collection "${collectionId}" is not available in this version.`
        state.error = message
        state.status = message
        touch()
        return false
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
      return true
    } catch (caught) {
      state.error = caught instanceof Error ? caught.message : 'Could not load the image collection.'
      touch()
      return false
    }
  }, [schedulePanelAdvance, moment, settingsOf, touch, writeSettings])

  const restoreFolder = useCallback(async (panelId: string) => {
    if (!moment) return
    const stored = await getPanelDirectoryHandle(moment.id, panelId)
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
    }
    releaseImageItems(state.images)
    state.images = []
    state.status = 'Choose an image collection, or use the panel menu for a local folder.'
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

// One page of results, so a search is one request. Paging further used to
// collect fifty playlists over five sequential requests, which nothing showed
// until the last of them returned — too slow to sit behind every keystroke,
// and more than anyone scrolls through to pick something to put on.
//
// Ten, and ten is not a preference: a playlist search takes no other page
// size. Measured against the live endpoint on 2026-09-27 — 10 answers 200,
// and 11, 12, 15, 20, 30 and 50 all answer 400 "Invalid limit", whatever the
// documented 0-50 range says. The paging this replaced asked for ten a page
// for that reason, not out of caution. More than ten playlists therefore
// means more requests; it cannot mean a bigger one.
const searchResultLimit = 10

// Below this many real playlists on the first page, fetch one more page before
// showing anything. Eight fills the visible list without a second request in
// the common case.
const minFirstPageResults = 8

interface SpotifyPlaylistSearchPage {
  playlists: { next: string | null; items: Array<SpotifyPlaylistApiItem | null> }
}

/**
 * Exported for its tests. The sequence guard below decides which reply to a
 * search is still wanted, and that is only observable from inside this hook —
 * the panel sees the answer, never the race that chose it.
 */
export function useSpotifyState(moment: Moment | null, panels: PanelsState): SpotifyState {
  const [tokens, setTokens] = useState<SpotifyTokens | null>(loadSpotifyTokens)
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([])
  const [tracks, setTracks] = useState<SpotifyTrackSummary[]>([])
  const [track, setTrack] = useState<SpotifyTrackState | null>(null)
  const [selectedTrack, setSelectedTrack] = useState<SpotifyTrackSummary | null>(null)
  // Counts every deliberate change to the held song: chosen, cleared, or
  // superseded by playing something. A lookup still in flight when that
  // happens is answering a question about an earlier state — the visitor may
  // have opened another moment, cleared the search or picked something else —
  // and must not put its answer back.
  const selectedTrackEpochRef = useRef(0)
  const changeSelectedTrack = useCallback((next: SpotifyTrackSummary | null) => {
    selectedTrackEpochRef.current += 1
    setSelectedTrack(next)
  }, [])
  const [signInFailed, setSignInFailed] = useState(false)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  // Only the connected panel shows this line, and it shows it before the
  // browser device has reported in. Asking someone to log in was wrong there
  // even before searching stopped needing a session: they already had one.
  const [status, setStatus] = useState('Choose a playlist to play.')
  const [error, setError] = useState<string | null>(null)
  const playerRef = useRef<Spotify.Player | null>(null)
  const tokensRef = useRef(tokens)
  // The panel searches as someone types, so a reply for "jaz" can land after
  // the reply for "jazz". Tracks and playlists share one counter because
  // switching the search type mid-flight can cross them too: only the most
  // recent request of either kind is allowed to set results.
  const searchSequenceRef = useRef(0)
  const positionBaseRef = useRef<{ positionMs: number; at: number; paused: boolean } | null>(null)
  const [playlistsHaveMore, setPlaylistsHaveMore] = useState(false)
  const playlistCursorRef = useRef<{ query: string; offset: number } | null>(null)

  useEffect(() => {
    tokensRef.current = tokens
  }, [tokens])

  // The Web Playback SDK reports state on events — a play, a pause, a track
  // change — and not while a track simply runs on. Read literally, that leaves
  // the progress bar sitting at whatever second the last event happened to
  // land on, for as long as nothing else occurs. So the bar keeps its own
  // clock between reports, and every report resets it to the truth.
  useEffect(() => {
    if (!tokens) return
    const intervalId = window.setInterval(() => {
      const base = positionBaseRef.current
      if (!base || base.paused) return
      setTrack((current) => {
        if (!current || current.paused) return current
        const next = Math.min(base.positionMs + (Date.now() - base.at), current.durationMs)
        // Below a quarter second the bar cannot show the difference, and the
        // render would cost more than it tells anyone.
        return Math.abs(next - current.positionMs) < 250 ? current : { ...current, positionMs: next }
      })
    }, 500)
    return () => window.clearInterval(intervalId)
  }, [tokens])

  useEffect(() => {
    setPlaylists([])
    setTracks([])
    setTrack(null)
    changeSelectedTrack(null)
  }, [moment?.id, changeSelectedTrack])

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
        const player = new window.Spotify.Player({ name: 'my-states.xyz', getOAuthToken: (callback) => callback(tokensRef.current?.accessToken ?? ''), volume: 0.7 })
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
          // Where playback truly was, and when we heard it. The clock below
          // counts on from here until the next report corrects it.
          positionBaseRef.current = { positionMs: state.position, at: Date.now(), paused: state.paused }
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
  // What has been asked about, and by which way of asking. "Once" means once
  // per playlist per way: the app can only describe a public playlist, so
  // "nothing found" before connecting says nothing about what the visitor's own
  // account can see, and must not stop the lookup being made with it later.
  const artworkLookupsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!playlistMissingArtwork) return
    const lookupKey = `${playlistMissingArtwork}:${tokens ? 'user' : 'app'}`
    if (artworkLookupsRef.current.has(lookupKey)) return
    artworkLookupsRef.current.add(lookupKey)
    let cancelled = false
    let answered = false
    void (async () => {
      try {
        // Artwork is public, so this works before anyone connects too: the
        // catalog endpoint answers the same question with the application's
        // credentials. An imported moment therefore shows its cover either way.
        const summary = tokens
          ? mapPlaylist(await spotifyFetch<SpotifyPlaylistApiItem>(`/playlists/${playlistMissingArtwork}`, (await ensureFreshTokens()).accessToken))
          : (await fetchCuratedPlaylists([playlistMissingArtwork]))[0]
        answered = true
        if (cancelled || !summary?.image) return
        setMomentPlaylist({ id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image }, undefined, { history: 'ignore' })
      } catch {
        // Artwork is decoration: a failed lookup must not interrupt playback.
        // Nor is it final. Forgetting the attempt lets the next thing that
        // changes — connecting Spotify, most likely — try again.
        if (!cancelled) artworkLookupsRef.current.delete(lookupKey)
      }
    })()
    return () => {
      cancelled = true
      // Cut off before it could say anything (the visitor finished connecting
      // while it was in flight): the attempt did not happen, so the run that
      // replaces this one must be free to make it.
      if (!answered) artworkLookupsRef.current.delete(lookupKey)
    }
  }, [ensureFreshTokens, playlistMissingArtwork, setMomentPlaylist, tokens])

  const login = useCallback(async () => startSpotifyLogin(), [])
  const clearSearchResults = useCallback(() => {
    // A search already on its way still carries the current sequence number,
    // and would pass its own guard and refill the list it was just cleared
    // from — under a box someone has emptied, beside the prompt to type in it.
    // Moving the sequence on is what makes that reply stale.
    searchSequenceRef.current += 1
    setPlaylists([])
    setTracks([])
    setPlaylistsHaveMore(false)
    playlistCursorRef.current = null
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
    try {
      setTokens(await exchangeSpotifyCode(code, state))
    } catch (caught) {
      setSignInFailed(true)
      throw caught
    }
    setSignInFailed(false)
    setStatus('Spotify login complete.')
    setError(null)
  }, [])
  const reportSignInFailure = useCallback(() => setSignInFailed(true), [])

  /**
   * One page of playlists, from whichever Spotify the asker has.
   *
   * Connected, that is Spotify itself with the visitor's own token, which is
   * what makes their results theirs. Not connected, it is this app's own
   * endpoint, which asks Spotify with the application's credentials — the
   * public catalog, and nothing that belongs to anybody.
   *
   * Both answer in the same shape, already mapped, because everything above
   * this line (the thin-first-page rule, the cursor, de-duplication, the
   * sequence guard) has no business knowing which of the two it got.
   */
  const fetchPlaylistPage = useCallback(async (query: string, offset: number, accessToken: string | null): Promise<SpotifyPlaylistSearchResult> => {
    if (accessToken === null) return searchCatalogPlaylists(query, offset)
    const params = new URLSearchParams({ q: query, type: 'playlist', limit: String(searchResultLimit), offset: String(offset) })
    const page = await requestSpotify(() => spotifyFetch<SpotifyPlaylistSearchPage>(`/search?${params.toString()}`, accessToken))
    return {
      items: page.playlists.items.filter(isSpotifyPlaylistApiItem).map(mapPlaylist),
      hasMore: Boolean(page.playlists.next),
    }
  }, [requestSpotify])

  // A search can take two requests (a thin first page is followed at once by a
  // second), and both must use the token this refreshes. Each `ensureFreshTokens`
  // call reads the `tokens` its render closed over, so a second call inside the
  // same search would find it still near expiry and refresh it again: a second
  // use of a refresh token that may already have been rotated, and a failure
  // there ends a session the first refresh had just renewed. Null when signed
  // out, which is the anonymous route.
  const searchAccessToken = useCallback(async (): Promise<string | null> => {
    if (!tokens) return null
    return (await ensureFreshTokens()).accessToken
  }, [ensureFreshTokens, tokens])

  const fetchTrackPage = useCallback(async (query: string): Promise<SpotifyTrackSearchResult> => {
    if (!tokens) return searchCatalogTracks(query)
    const fresh = await ensureFreshTokens()
    const result = await requestSpotify(() => spotifyFetch<{ tracks: { items: Array<SpotifyTrackApiItem | null> } }>(
      `/search?${new URLSearchParams({ q: query, type: 'track', limit: String(searchResultLimit) }).toString()}`,
      fresh.accessToken,
    ))
    return { items: result.tracks.items.filter(isSpotifyTrackApiItem).map(mapTrack) }
  }, [ensureFreshTokens, requestSpotify, tokens])

  const searchPlaylists = useCallback(async (query: string) => {
    const sequence = ++searchSequenceRef.current
    const trimmed = query.trim()
    if (!trimmed) {
      setPlaylists([])
      setPlaylistsHaveMore(false)
      playlistCursorRef.current = null
      return
    }
    const accessToken = await searchAccessToken()
    if (sequence !== searchSequenceRef.current) return
    const first = await fetchPlaylistPage(trimmed, 0, accessToken)
    if (sequence !== searchSequenceRef.current) return

    let items = [...first.items]
    let offset = searchResultLimit
    let hasMore = first.hasMore

    // Spotify blanks entries in playlist search results: a full page of ten
    // came back carrying six real playlists for "dark techno" (measured
    // 2026-09-27), and the blanks are already dropped by the time a page
    // reaches here. A thin first page is the one case worth a second request
    // straight away, so a search does not open on a near-empty list.
    if (hasMore && items.length < minFirstPageResults) {
      const second = await fetchPlaylistPage(trimmed, offset, accessToken)
      if (sequence !== searchSequenceRef.current) return
      items = items.concat(second.items)
      offset += searchResultLimit
      hasMore = second.hasMore
    }

    setPlaylists([...new Map(items.map((item) => [item.id, item])).values()])
    playlistCursorRef.current = { query: trimmed, offset }
    setPlaylistsHaveMore(hasMore)
    setError(null)
  }, [fetchPlaylistPage, searchAccessToken])

  // Asked for by the person reading the list, so it appends rather than
  // replacing, and a search started in the meantime cancels it.
  const loadMorePlaylists = useCallback(async () => {
    const cursor = playlistCursorRef.current
    if (!cursor) return
    const sequence = searchSequenceRef.current
    const accessToken = await searchAccessToken()
    if (sequence !== searchSequenceRef.current) return
    const page = await fetchPlaylistPage(cursor.query, cursor.offset, accessToken)
    if (sequence !== searchSequenceRef.current || playlistCursorRef.current?.query !== cursor.query) return
    setPlaylists((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()])
    playlistCursorRef.current = { query: cursor.query, offset: cursor.offset + searchResultLimit }
    setPlaylistsHaveMore(page.hasMore)
    setError(null)
  }, [fetchPlaylistPage, searchAccessToken])

  const searchTracks = useCallback(async (query: string) => {
    const sequence = ++searchSequenceRef.current
    const trimmed = query.trim()
    if (!trimmed) {
      setTracks([])
      return
    }
    const result = await fetchTrackPage(buildTrackSearchQuery(trimmed))
    if (sequence !== searchSequenceRef.current) return
    setTracks(rankTracks(result.items, trimmed))
    setError(null)
  }, [fetchTrackPage])

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
    // Playback has been accepted, so whatever song was being held for Play is
    // superseded. The player only reports what is playing some moments later,
    // and until it does the held song would still outrank this in the panel.
    changeSelectedTrack(null)
    setMomentPlaylist(selected, panelId)
    setPlaylists((current) => [summary, ...current.filter((candidate) => candidate.id !== summary.id)])
    setStatus(`Playing ${summary.name}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify, setMomentPlaylist])

  /**
   * Choosing a playlist, which is not the same as playing it. A visitor who
   * has not connected Spotify can still say which playlist this panel is
   * about; playback is the step that needs their account, and it is offered
   * separately rather than smuggled into the click that chose the playlist.
   */
  const selectPlaylist = useCallback((summary: SpotifyPlaylistSummary, panelId?: string) => {
    setMomentPlaylist({ id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image }, panelId)
    // The newest choice is the one that counts. A song chosen earlier outranks
    // the panel's playlist wherever the panel decides what is chosen, so it has
    // to go, or the panel keeps describing — and, after connecting, plays — the
    // song instead of the playlist that was just picked.
    changeSelectedTrack(null)
    setStatus(`${summary.name} is ready.`)
    setError(null)
  }, [setMomentPlaylist])

  const selectTrack = useCallback((summary: SpotifyTrackSummary | null) => {
    changeSelectedTrack(summary)
    if (summary) setError(null)
  }, [])

  const lookupTrack = useCallback(async (trackId: string) => {
    if (!tokens) return
    // What the held song was when this was asked. If it has been changed by
    // the time the answer arrives, the answer is stale and is dropped.
    const epoch = selectedTrackEpochRef.current
    const fresh = await ensureFreshTokens()
    const item = await requestSpotify(() => spotifyFetch<SpotifyTrackApiItem>(`/tracks/${encodeURIComponent(trackId)}`, fresh.accessToken))
    if (selectedTrackEpochRef.current !== epoch) return
    setSelectedTrack(mapTrack(item))
  }, [ensureFreshTokens, requestSpotify, tokens])

  const playPlaylist = useCallback(async (summary?: SpotifyPlaylistSummary, panelId?: string) => {
    const panelPlaylist = (panelId ? panels.get(panelId) : undefined)?.type === 'spotify' ? (panels.get(panelId!) as Panel<'spotify'>).config.playlist : undefined
    const selected = summary ? { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, image: summary.image } : panelPlaylist ?? defaultSpotifyPlaylistReference
    if (!selected.uri) throw new Error('Choose a playlist first.')
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ context_uri: selected.uri }) }))
    // Playback has been accepted, so whatever song was being held for Play is
    // superseded. The player only reports what is playing some moments later,
    // and until it does the held song would still outrank this in the panel.
    changeSelectedTrack(null)
    setMomentPlaylist(selected, panelId)
    setStatus(`Playing ${selected.name ?? 'playlist'}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify, panels, setMomentPlaylist])

  const playTrack = useCallback(async (summary: SpotifyTrackSummary, _panelId?: string) => {
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ uris: [summary.uri] }) }))
    // Playback has been accepted, and this is now the song Play is for. It has
    // to stay that way until the player reports what is playing, which it does
    // some moments later: cleared here, a second press of Play in that gap would
    // find nothing held and fall through to the moment's saved playlist,
    // replacing the song that was just started. Held, a second press only asks
    // for the same song again. The panel lets it go when the player reports.
    changeSelectedTrack(summary)
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
    tokens, playlists, tracks, track, selectedTrack, deviceId, isReady, status, error, login, logout, clearSearchResults, handleCallback, signInFailed, reportSignInFailure, searchPlaylists, searchTracks, loadPlaylistFromUrl,
    selectPlaylist, selectTrack, lookupTrack, playPlaylist, playTrack,
    playlistsHaveMore, loadMorePlaylists,
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
  /** The note's `content` is behind its `document` and must be derived again. */
  markdownStale: boolean
  /**
   * The panel's mounted editor and the note it holds. The note matters: for
   * a moment after the panel is pointed at a different note, the editor
   * still standing here is the one for the note being left.
   */
  editor: { noteId: string, handle: NotesEditorHandle } | null
  /** A rename that arrived before the editor mounted, and the note it named. */
  pendingRename: { noteId: string; title: string } | null
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
  const created: NotesPanelRuntimeState = { activeNote: null, dirty: false, saveTimer: null, markdownStale: false, editor: null, pendingRename: null }
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
    status: 'Choose an image collection, or use the panel menu for a local folder.',
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
    momentId,
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

