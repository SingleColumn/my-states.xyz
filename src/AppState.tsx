import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ImageItem,
  Note,
  Panel,
  Session,
  SessionSummary,
  SlideshowSettings,
  SpotifyPlaylistReference,
  SpotifyTokens,
  SpotifyTrackState,
} from './types'
import {
  clearDirectoryHandle,
  clearPanelDirectoryHandle,
  createSession as createStoredSession,
  defaultSlideshowSettings,
  defaultSpotifyPlaylistReference,
  deleteNote as deleteStoredNote,
  deleteSession as deleteStoredSession,
  getDirectoryHandle,
  getPanelDirectoryHandle,
  getNotes,
  getSession,
  getSessionAssets,
  getSessionSummaries,
  initializeSessions,
  replaceSessionAssets,
  saveDirectoryHandle,
  savePanelDirectoryHandle,
  saveNote,
  saveSession,
  saveSpotifyTokens,
  setActiveSessionId,
  sessionLimits,
  loadSpotifyTokens,
} from './storage'
import { downloadSessionArchive, exportSessionArchive, importSessionArchive } from './sessionArchive'
import { createId } from './utils'
import { createImageItemsFromBundledCollection, getBundledCollection } from './imageCollections'
import {
  releaseImageItems,
  settingsForBundledCollection,
  settingsForClearedImages,
  settingsForSessionAssets,
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
  setActiveNoteContent(content: string, panelId: string): void
  setActiveNoteTitle(title: string, panelId: string): void
  createNote(panelId: string): Promise<void>
  selectNote(id: string, panelId: string): void
  deleteNote(id: string, panelId: string): Promise<void>
  flush(): Promise<void>
}

interface SlideshowState {
  settingsFor(panelId: string): SlideshowSettings
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
  playlist: SpotifyPlaylistReference
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

interface SessionsState {
  isReady: boolean
  sessions: SessionSummary[]
  activeSession: Session | null
  error: string | null
  create(name: string): Promise<void>
  open(sessionId: string): Promise<void>
  rename(name: string): Promise<void>
  remove(sessionId: string): Promise<void>
  exportActive(): Promise<void>
  importFile(file: File): Promise<void>
  updateCanvas(canvas: Session['canvas']): void
  addPanels(panels: Session['panels']): void
  updatePanel(panelId: string, update: (panel: Panel) => Panel): void
  registerCanvasFlush(flush: () => void | Promise<void>): () => void
}

interface AppStateValue {
  sessions: SessionsState
  notes: NotesState
  slideshow: SlideshowState
  spotify: SpotifyState
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const sessionCore = useSessionState()
  const notes = useNotesState(sessionCore.activeSession, sessionCore.patchActiveSession)
  const slideshow = useSlideshowState(sessionCore.activeSession, sessionCore.patchActiveSession)
  const spotify = useSpotifyState(sessionCore.activeSession, sessionCore.patchActiveSession)

  const sessions = useMemo<SessionsState>(
    () => ({
      isReady: sessionCore.isReady,
      sessions: sessionCore.sessions,
      activeSession: sessionCore.activeSession,
      error: sessionCore.error,
      create: async (name) => {
        await notes.flush()
        await sessionCore.flush()
        await sessionCore.create(name)
      },
      open: async (sessionId) => {
        await notes.flush()
        await sessionCore.flush()
        await sessionCore.open(sessionId)
      },
      rename: sessionCore.rename,
      remove: async (sessionId) => {
        await notes.flush()
        await sessionCore.flush()
        await sessionCore.remove(sessionId)
      },
      exportActive: async () => {
        await notes.flush()
        if (!sessionCore.activeSession) throw new Error('No session is open.')
        await sessionCore.flush()
        const blob = await exportSessionArchive(sessionCore.activeSession.id)
        downloadSessionArchive(blob, sessionCore.activeSession.name)
      },
      importFile: async (file) => {
        await notes.flush()
        await sessionCore.flush()
        const imported = await importSessionArchive(file)
        await sessionCore.open(imported.id)
      },
      updateCanvas: sessionCore.updateCanvas,
      addPanels: (panels) => sessionCore.patchActiveSession((current) => ({ ...current, panels: addAllowedPanels(current.panels, panels) })),
      updatePanel: (panelId, update) => sessionCore.patchActiveSession((current) => ({ ...current, panels: current.panels.map((panel) => panel.id === panelId ? update(panel) : panel) })),
      registerCanvasFlush: sessionCore.registerCanvasFlush,
    }),
    [notes, sessionCore],
  )

  const value = useMemo(() => ({ sessions, notes, slideshow, spotify }), [sessions, notes, slideshow, spotify])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState must be used inside AppStateProvider')
  return value
}

export function addAllowedPanels(existing: Panel[], additions: Panel[]) {
  let spotifyExists = existing.some((panel) => panel.type === 'spotify')
  const allowed = additions.filter((panel) => {
    if (panel.type !== 'spotify') return true
    if (spotifyExists) return false
    spotifyExists = true
    return true
  })
  return [...existing, ...allowed]
}

function useSessionState() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeSessionRef = useRef<Session | null>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const canvasFlushRef = useRef<(() => void | Promise<void>) | null>(null)

  const refreshSummaries = useCallback(async () => {
    setSessions(await getSessionSummaries())
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const initial = await initializeSessions()
        const session = await getSession(initial.activeSessionId)
        if (cancelled || !session) return
        activeSessionRef.current = session
        setActiveSession(session)
        setSessions((await getSessionSummaries()).map((item) => item))
        setError(null)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load local sessions.')
      } finally {
        if (!cancelled) setIsReady(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback(async (session: Session) => {
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const saved = await saveSession(session)
      if (activeSessionRef.current?.id === saved.id) {
        activeSessionRef.current = saved
        setActiveSession(saved)
      }
    })
    await saveQueueRef.current
    await refreshSummaries()
  }, [refreshSummaries])

  const patchActiveSession = useCallback(
    (patch: (current: Session) => Session) => {
      const current = activeSessionRef.current
      if (!current) return
      const next = patch(current)
      activeSessionRef.current = next
      setActiveSession(next)
      void persist(next).catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not save the session.'))
    },
    [persist],
  )

  const registerCanvasFlush = useCallback((flush: () => void | Promise<void>) => {
    canvasFlushRef.current = flush
    return () => {
      if (canvasFlushRef.current === flush) canvasFlushRef.current = null
    }
  }, [])

  const flush = useCallback(async () => {
    await canvasFlushRef.current?.()
    await saveQueueRef.current
  }, [])

  const open = useCallback(async (sessionId: string) => {
    await flush()
    const session = await getSession(sessionId)
    if (!session) throw new Error('The requested session no longer exists.')
    await setActiveSessionId(sessionId)
    activeSessionRef.current = session
    setActiveSession(session)
    setError(null)
  }, [flush])

  const create = useCallback(async (name: string) => {
    const session = await createStoredSession(name)
    await refreshSummaries()
    await open(session.id)
  }, [open, refreshSummaries])

  const rename = useCallback(async (name: string) => {
    const current = activeSessionRef.current
    if (!current) return
    const next = await saveSession({ ...current, name })
    activeSessionRef.current = next
    setActiveSession(next)
    await refreshSummaries()
  }, [refreshSummaries])

  const remove = useCallback(async (sessionId: string) => {
    const removingActive = activeSessionRef.current?.id === sessionId
    await deleteStoredSession(sessionId)
    const remaining = await getSessionSummaries()
    setSessions(remaining)
    if (!removingActive) return

    if (remaining[0]) {
      await open(remaining[0].id)
      return
    }

    const replacement = await createStoredSession('My first session')
    setSessions(await getSessionSummaries())
    await open(replacement.id)
  }, [open])

  const updateCanvas = useCallback((canvas: Session['canvas']) => {
    patchActiveSession((current) => ({ ...current, canvas }))
  }, [patchActiveSession])

  return {
    isReady,
    sessions,
    activeSession,
    error,
    create,
    open,
    rename,
    remove,
    updateCanvas,
    patchActiveSession,
    registerCanvasFlush,
    flush,
  }
}

function useNotesState(session: Session | null, patchSession: (patch: (current: Session) => Session) => void): NotesState {
  const [notes, setNotes] = useState<Note[]>([])

  const persistPanelNote = useCallback(async (panelId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    const note = state.activeNote
    if (!note || !state.dirty) return
    state.dirty = false
    await saveNote(note)
    setNotes((current) => [note, ...current.filter((candidate) => candidate.id !== note.id)].sort((a, b) => b.updatedAt - a.updatedAt))
  }, [])

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

  useEffect(() => {
    let cancelled = false
    const sessionId = session?.id ?? ''
    const notePanels = session?.panels.filter((panel): panel is Extract<Panel, { type: 'notes' }> => panel.type === 'notes') ?? []

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
      if (!sessionId) return
      const storedNotes = await getNotes(sessionId)
      if (cancelled) return
      setNotes(storedNotes)
      for (const panel of notePanels) {
        const selected = storedNotes.find((note) => note.id === panel.config.activeNoteId) ?? storedNotes[0] ?? null
        getNotesPanelRuntimeState(panel.id).activeNote = selected
      }
    }
    void load()

    return () => {
      cancelled = true
      void flush()
    }
  }, [flush, session?.id]) // Session changes are the loading boundary.

  const scheduleSave = useCallback((panelId: string) => {
    const state = getNotesPanelRuntimeState(panelId)
    state.dirty = true
    if (state.saveTimer !== null) window.clearTimeout(state.saveTimer)
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null
      void persistPanelNote(panelId)
    }, 500)
  }, [persistPanelNote])

  const createNote = useCallback(async (panelId: string) => {
    if (!session) return
    const now = Date.now()
    const note: Note = {
      id: createId('note'),
      sessionId: session.id,
      title: 'Untitled note',
      content: '',
      createdAt: now,
      updatedAt: now,
    }
    await saveNote(note)
    const state = getNotesPanelRuntimeState(panelId)
    state.activeNote = note
    setNotes((current) => [note, ...current])
    patchNotesPanel(note.id, patchSession, panelId)
  }, [patchSession, session])

  const selectNote = useCallback((id: string, panelId: string) => {
    const next = notes.find((note) => note.id === id)
    if (!next) return
    void flush(panelId)
    getNotesPanelRuntimeState(panelId).activeNote = next
    patchNotesPanel(next.id, patchSession, panelId)
  }, [flush, notes, patchSession])

  const deleteNote = useCallback(async (id: string, panelId: string) => {
    await flush(panelId)
    await deleteStoredNote(id)
    const nextNotes = notes.filter((note) => note.id !== id)
    setNotes(nextNotes)
    const state = getNotesPanelRuntimeState(panelId)
    if (state.activeNote?.id === id) {
      const next = nextNotes[0] ?? null
      state.activeNote = next
      patchNotesPanel(next?.id ?? null, patchSession, panelId)
    }
  }, [flush, notes, patchSession])

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

  return { notes, setActiveNoteContent, setActiveNoteTitle, createNote, selectNote, deleteNote, flush }
}

function useSlideshowState(session: Session | null, patchSession: (patch: (current: Session) => Session) => void): SlideshowState {
  const [, rerender] = useState(0)
  const touch = useCallback(() => rerender((value) => value + 1), [])
  const panels = session?.panels.filter((panel): panel is Extract<Panel, { type: 'slideshow' }> => panel.type === 'slideshow') ?? []

  useEffect(() => {
    let cancelled = false
    const activeIds = new Set(panels.map((panel) => panel.id))
    for (const [panelId, state] of slideshowPanelRuntimeStates) {
      if (!activeIds.has(panelId)) {
        if (state.timerId !== null) window.clearTimeout(state.timerId)
        releaseImageItems(state.images)
        slideshowPanelRuntimeStates.delete(panelId)
      }
    }
    for (const panel of panels) {
      const state = getSlideshowPanelRuntimeState(panel.id)
      if (state.timerId !== null) window.clearTimeout(state.timerId)
      state.timerId = null
      state.isPlaying = false
      state.status = statusForImageSource(panel.config.imageSource, 0)
      state.error = null
      releaseImageItems(state.images)
      state.images = []
    }
    touch()

    async function loadPanel(panel: Extract<Panel, { type: 'slideshow' }>) {
      const state = getSlideshowPanelRuntimeState(panel.id)
      try {
        const source = panel.config.imageSource
        if (source.type === 'none') {
          state.status = 'Choose your images or try a sample collection.'
          return
        }
        let nextImages: ImageItem[]
        if (source.type === 'bundled') {
          if (!getBundledCollection(source.collectionId)) {
            const message = `The sample collection "${source.collectionId}" is not available in this version.`
            state.status = message
            state.error = message
            return
          }
          nextImages = await createImageItemsFromBundledCollection(source.collectionId) ?? []
        } else {
          const assets = await getSessionAssets(session!.id, panel.id)
          nextImages = await Promise.all(assets.map(createImageItemFromAsset))
          nextImages.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
        }
        if (cancelled) {
          releaseImageItems(nextImages)
          return
        }
        state.images = nextImages
        state.status = statusForImageSource(source, nextImages.length)
        if (panel.config.currentIndex >= nextImages.length && panel.config.currentIndex !== 0) {
          patchSlideshow({ ...panel.config, currentIndex: 0 }, patchSession, panel.id)
        }
        touch()
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : 'Could not load session images.'
          state.status = message
          state.error = message
          touch()
        }
      }
    }
    if (!session) return () => { cancelled = true }
    for (const panel of panels) void loadPanel(panel)
    return () => { cancelled = true }
  }, [session?.id])

  const sessionRef = useRef(session)
  const patchSessionRef = useRef(patchSession)
  sessionRef.current = session
  patchSessionRef.current = patchSession

  const schedulePanelAdvance = useCallback((panelId: string) => {
    const state = getSlideshowPanelRuntimeState(panelId)
    if (!state.isPlaying || state.timerId !== null) return

    const panel = sessionRef.current?.panels.find((candidate): candidate is Extract<Panel, { type: 'slideshow' }> => candidate.id === panelId && candidate.type === 'slideshow')
    if (!panel) {
      state.isPlaying = false
      return
    }

    state.timerId = window.setTimeout(() => {
      state.timerId = null
      const currentPanel = sessionRef.current?.panels.find((candidate): candidate is Extract<Panel, { type: 'slideshow' }> => candidate.id === panelId && candidate.type === 'slideshow')
      if (!currentPanel || !state.isPlaying) return
      if (state.images.length) {
        patchSlideshow({
          ...currentPanel.config,
          currentIndex: getNextImageIndex(currentPanel.config.currentIndex, state.images.length, currentPanel.config.shuffle),
        }, patchSessionRef.current, panelId)
      }
      schedulePanelAdvance(panelId)
    }, panel.config.intervalMs)
  }, [])

  const replaceImages = useCallback(async (files: FileList | File[], folderName: string, panelId: string) => {
    if (!session) return
    const selected = Array.from(files).filter(isSupportedImageFile)
    if (selected.length > sessionLimits.maxImageCount) throw new Error(`A session can contain at most ${sessionLimits.maxImageCount} images.`)
    const assets = await Promise.all(selected.map((file) => createSessionAsset(file, session.id, panelId)))
    await replaceSessionAssets(session.id, assets, panelId)
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
    const current = getSlideshowSettingsForPanel(session, panelId, defaultSlideshowSettings)
    patchSlideshow(settingsForSessionAssets(current, folderName), patchSession, panelId)
    touch()
  }, [patchSession, session, touch])

  const loadImagesFromHandle = useCallback(async (handle: FileSystemDirectoryHandle, panelId: string) => {
    const files: File[] = []
    for await (const file of readImageFilesFromDirectory(handle)) files.push(file)
    await replaceImages(files, handle.name, panelId)
  }, [replaceImages])

  const selectFolder = useCallback(async (panelId: string) => {
    if (!session) return false
    if (!window.showDirectoryPicker) {
      getSlideshowPanelRuntimeState(panelId).error = 'Folder selection is unavailable in this browser. Use the file picker instead.'
      touch()
      return false
    }
    try {
      const handle = await window.showDirectoryPicker()
      await savePanelDirectoryHandle(session.id, panelId, handle)
      await loadImagesFromHandle(handle, panelId)
      return true
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return true
      const state = getSlideshowPanelRuntimeState(panelId)
      state.error = caught instanceof Error ? caught.message : 'Could not select the folder.'
      touch()
      return false
    }
  }, [loadImagesFromHandle, session, touch])

  const selectBundledCollection = useCallback(async (collectionId: string, panelId: string) => {
    if (!session) throw new Error('Open a session before selecting images.')
    const collection = getBundledCollection(collectionId)
    const state = getSlideshowPanelRuntimeState(panelId)
    if (!collection) {
      const message = `The sample collection "${collectionId}" is not available in this version.`
      state.error = message
      state.status = message
      touch()
      return
    }
    try {
      const nextImages = await createImageItemsFromBundledCollection(collectionId) ?? []
      if (state.timerId !== null) window.clearTimeout(state.timerId)
      state.timerId = null
      releaseImageItems(state.images)
      state.images = nextImages
      state.isPlaying = nextImages.length > 0
      const current = getSlideshowSettingsForPanel(session, panelId, defaultSlideshowSettings)
      const nextSettings = settingsForBundledCollection(current, collection.id)
      patchSlideshow(nextSettings, patchSession, panelId)
      state.status = statusForImageSource(nextSettings.imageSource, nextImages.length)
      state.error = null
      if (state.isPlaying) schedulePanelAdvance(panelId)
      touch()
    } catch (caught) {
      state.error = caught instanceof Error ? caught.message : 'Could not load the sample collection.'
      touch()
    }
  }, [patchSession, schedulePanelAdvance, session, touch])

  const restoreFolder = useCallback(async (panelId: string) => {
    if (!session) return
    const stored = await getPanelDirectoryHandle(session.id, panelId) ?? await getDirectoryHandle(session.id)
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
  }, [loadImagesFromHandle, session, touch])

  const resetFolder = useCallback(async (panelId: string) => {
    if (!session) return
    const state = getSlideshowPanelRuntimeState(panelId)
    const current = getSlideshowSettingsForPanel(session, panelId, defaultSlideshowSettings)
    if (state.timerId !== null) window.clearTimeout(state.timerId)
    state.timerId = null
    state.isPlaying = false
    if (current.imageSource.type === 'session-assets') {
      await replaceSessionAssets(session.id, [], panelId)
      await clearPanelDirectoryHandle(session.id, panelId)
      await clearDirectoryHandle(session.id)
    }
    releaseImageItems(state.images)
    state.images = []
    state.status = 'Choose your images or try a sample collection.'
    state.error = null
    patchSlideshow(settingsForClearedImages(current), patchSession, panelId)
    touch()
  }, [patchSession, session, touch])

  const stop = useCallback((panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    if (state.timerId !== null) window.clearTimeout(state.timerId)
    state.timerId = null
    state.isPlaying = false
    const current = getSlideshowSettingsForPanel(session, panelId, defaultSlideshowSettings)
    patchSlideshow({ ...current, currentIndex: 0 }, patchSession, panelId)
    touch()
  }, [patchSession, session, touch])

  const next = useCallback((panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    const current = getSlideshowSettingsForPanel(session, panelId, defaultSlideshowSettings)
    patchSlideshow({ ...current, currentIndex: getNextImageIndex(current.currentIndex, state.images.length, current.shuffle) }, patchSession, panelId)
  }, [patchSession, session])

  const previous = useCallback((panelId?: string) => {
    if (!panelId) return
    const state = getSlideshowPanelRuntimeState(panelId)
    const current = getSlideshowSettingsForPanel(session, panelId, defaultSlideshowSettings)
    patchSlideshow({ ...current, currentIndex: state.images.length ? (current.currentIndex - 1 + state.images.length) % state.images.length : 0 }, patchSession, panelId)
  }, [patchSession, session])

  const updateSettings = useCallback((partial: Partial<SlideshowSettings>, panelId?: string) => {
    if (!panelId) return
    const current = getSlideshowSettingsForPanel(sessionRef.current, panelId, defaultSlideshowSettings)
    const state = getSlideshowPanelRuntimeState(panelId)
    if (partial.intervalMs !== undefined && state.timerId !== null) {
      window.clearTimeout(state.timerId)
      state.timerId = null
    }
    patchSlideshow({ ...current, ...partial }, patchSessionRef.current, panelId)
    if (partial.intervalMs !== undefined && state.isPlaying) schedulePanelAdvance(panelId)
  }, [schedulePanelAdvance])

  return {
    settingsFor: (panelId) => getSlideshowSettingsForPanel(session, panelId, defaultSlideshowSettings),
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
      else if (state.timerId !== null) {
        window.clearTimeout(state.timerId)
        state.timerId = null
      }
      touch()
    },
    stop, next, previous, updateSettings,
  }
}

function useSpotifyState(session: Session | null, patchSession: (patch: (current: Session) => Session) => void): SpotifyState {
  const [tokens, setTokens] = useState<SpotifyTokens | null>(loadSpotifyTokens)
  const [playlist, setPlaylist] = useState<SpotifyPlaylistReference>(defaultSpotifyPlaylistReference)
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
    setPlaylist(session?.panels.find((panel) => panel.type === 'spotify')?.config.playlist ?? defaultSpotifyPlaylistReference)
    setPlaylists([])
    setTracks([])
    setTrack(null)
  }, [session?.id])

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

  const setSessionPlaylist = useCallback((next: SpotifyPlaylistReference, panelId?: string) => {
    setPlaylist(next)
    patchSession((current) => {
      const panel = current.panels.find((candidate) => candidate.id === panelId && candidate.type === 'spotify')
        ?? current.panels.find((candidate) => candidate.type === 'spotify')
      return panel ? { ...current, panels: current.panels.map((candidate) => candidate.id === panel.id ? { ...candidate, config: { playlist: next }, updatedAt: Date.now() } : candidate) as Panel[] } : current
    })
  }, [patchSession])

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
    const selected = { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url }
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ context_uri: selected.uri }) }))
    setSessionPlaylist(selected, panelId)
    setPlaylists((current) => [summary, ...current.filter((candidate) => candidate.id !== summary.id)])
    setStatus(`Playing ${summary.name}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify, setSessionPlaylist])

  const playPlaylist = useCallback(async (summary?: SpotifyPlaylistSummary, panelId?: string) => {
    const panelPlaylist = (session?.panels.find((panel) => panel.id === panelId) as Extract<Panel, { type: 'spotify' }> | undefined)?.config.playlist
    const selected = summary ? { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url } : panelPlaylist ?? playlist
    if (!selected.uri) throw new Error('Choose a playlist first.')
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ context_uri: selected.uri }) }))
    setSessionPlaylist(selected, panelId)
    setStatus(`Playing ${selected.name ?? 'playlist'}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, playlist, requestSpotify, setSessionPlaylist])

  const playTrack = useCallback(async (summary: SpotifyTrackSummary, _panelId?: string) => {
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ uris: [summary.uri] }) }))
    setStatus(`Playing ${summary.name} by ${summary.artists}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify])

  const togglePlay = useCallback(async (panelId?: string) => {
    const panelPlaylist = (session?.panels.find((panel) => panel.id === panelId) as Extract<Panel, { type: 'spotify' }> | undefined)?.config.playlist
    const selectedPlaylist = panelPlaylist ?? playlist
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
  }, [playPlaylist, playlist, session, track])

  return {
    tokens, playlist, playlists, tracks, track, deviceId, isReady, status, error, login, logout, clearSearchResults, handleCallback, searchPlaylists, searchTracks, loadPlaylistFromUrl, playPlaylist, playTrack,
    togglePlay,
    previousTrack: async () => playerRef.current?.previousTrack(),
    nextTrack: async () => playerRef.current?.nextTrack(),
    setVolume: async (value) => playerRef.current?.setVolume(value),
    seek: async (positionMs) => playerRef.current?.seek(positionMs),
  }
}

function patchSlideshow(settings: SlideshowSettings, patchSession: (patch: (current: Session) => Session) => void, panelId?: string) {
  patchSession((current) => {
    if (!panelId) return current
    const panel = current.panels.find((candidate) => candidate.id === panelId && candidate.type === 'slideshow')
    return panel ? { ...current, panels: current.panels.map((candidate) => candidate.id === panel.id ? { ...candidate, config: settings, updatedAt: Date.now() } : candidate) as Panel[] } : current
  })
}

interface NotesPanelRuntimeState {
  activeNote: Note | null
  dirty: boolean
  saveTimer: number | null
}

interface SlideshowPanelRuntimeState {
  images: ImageItem[]
  isPlaying: boolean
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

function getSlideshowPanelRuntimeState(panelId: string): SlideshowPanelRuntimeState {
  const existing = slideshowPanelRuntimeStates.get(panelId)
  if (existing) return existing
  const created: SlideshowPanelRuntimeState = {
    images: [],
    isPlaying: false,
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

function getSlideshowSettingsForPanel(session: Session | null, panelId: string | undefined, fallback: SlideshowSettings) {
  return (session?.panels.find((panel) => panel.id === panelId) as Extract<Panel, { type: 'slideshow' }> | undefined)?.config ?? fallback
}

function patchNotesPanel(activeNoteId: string | null, patchSession: (patch: (current: Session) => Session) => void, panelId: string) {
  patchSession((current) => {
    const panel = current.panels.find((candidate) => candidate.id === panelId && candidate.type === 'notes')
    return panel ? { ...current, panels: current.panels.map((candidate) => candidate.id === panel.id ? { ...candidate, config: { activeNoteId }, updatedAt: Date.now() } : candidate) as Panel[] } : current
  })
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

async function createSessionAsset(file: File, sessionId: string, panelId?: string) {
  if (file.size > sessionLimits.maxImageBytes) throw new Error(`${file.name} exceeds the 25 MB per-image limit.`)
  const mimeType = normaliseImageMimeType(file)
  if (!mimeType) throw new Error(`${file.name} is not a supported image type.`)
  const url = URL.createObjectURL(file)
  const dimensions = await readImageDimensions(url)
  URL.revokeObjectURL(url)
  return {
    id: createId('image'),
    sessionId,
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

async function createImageItemFromAsset(asset: Awaited<ReturnType<typeof getSessionAssets>>[number]) {
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
