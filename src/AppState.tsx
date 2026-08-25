import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ImageItem,
  Note,
  Session,
  SessionSummary,
  SlideshowSettings,
  SpotifyPlaylistReference,
  SpotifyTokens,
  SpotifyTrackState,
} from './types'
import {
  clearDirectoryHandle,
  createSession as createStoredSession,
  defaultSlideshowSettings,
  defaultSpotifyPlaylistReference,
  deleteNote as deleteStoredNote,
  deleteSession as deleteStoredSession,
  getDirectoryHandle,
  getNotes,
  getSession,
  getSessionAssets,
  getSessionSummaries,
  initializeSessions,
  replaceSessionAssets,
  saveDirectoryHandle,
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
  activeNote: Note | null
  setActiveNoteContent(content: string): void
  setActiveNoteTitle(title: string): void
  createNote(): Promise<void>
  selectNote(id: string): void
  deleteNote(id: string): Promise<void>
  flush(): Promise<void>
}

interface SlideshowState {
  settings: SlideshowSettings
  images: ImageItem[]
  isPlaying: boolean
  status: string
  error: string | null
  selectFolder(): Promise<boolean>
  importFiles(files: FileList | File[]): Promise<void>
  selectBundledCollection(collectionId: string): Promise<void>
  resetFolder(): Promise<void>
  restoreFolder(): Promise<void>
  setIsPlaying(value: boolean): void
  stop(): void
  next(): void
  previous(): void
  updateSettings(settings: Partial<SlideshowSettings>): void
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
  loadPlaylistFromUrl(url: string): Promise<void>
  playPlaylist(summary?: SpotifyPlaylistSummary): Promise<void>
  playTrack(summary: SpotifyTrackSummary): Promise<void>
  togglePlay(): Promise<void>
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
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const activeNoteRef = useRef<Note | null>(null)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)

  const persistActiveNote = useCallback(async () => {
    const note = activeNoteRef.current
    if (!note || !dirtyRef.current) return
    dirtyRef.current = false
    await saveNote(note)
    setNotes((current) => [note, ...current.filter((candidate) => candidate.id !== note.id)].sort((a, b) => b.updatedAt - a.updatedAt))
  }, [])

  const flush = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    await persistActiveNote()
  }, [persistActiveNote])

  useEffect(() => {
    let cancelled = false
    void flush()
    activeNoteRef.current = null
    setActiveNote(null)
    setNotes([])

    const sessionId = session?.id ?? ''
    const activeNoteId = session?.activeNoteId
    if (!sessionId) return
    async function load() {
      const storedNotes = await getNotes(sessionId)
      if (cancelled) return
      const selected = storedNotes.find((note) => note.id === activeNoteId) ?? storedNotes[0] ?? null
      activeNoteRef.current = selected
      setNotes(storedNotes)
      setActiveNote(selected)
    }
    void load()

    return () => {
      cancelled = true
      void flush()
    }
  }, [session?.id]) // Session changes are the loading boundary.

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persistActiveNote()
    }, 500)
  }, [persistActiveNote])

  const createNote = useCallback(async () => {
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
    activeNoteRef.current = note
    setNotes((current) => [note, ...current])
    setActiveNote(note)
    patchSession((current) => ({ ...current, activeNoteId: note.id }))
  }, [patchSession, session])

  const selectNote = useCallback((id: string) => {
    const next = notes.find((note) => note.id === id)
    if (!next) return
    void flush()
    activeNoteRef.current = next
    setActiveNote(next)
    patchSession((current) => ({ ...current, activeNoteId: next.id }))
  }, [flush, notes, patchSession])

  const deleteNote = useCallback(async (id: string) => {
    await flush()
    await deleteStoredNote(id)
    const nextNotes = notes.filter((note) => note.id !== id)
    setNotes(nextNotes)
    if (activeNoteRef.current?.id === id) {
      const next = nextNotes[0] ?? null
      activeNoteRef.current = next
      setActiveNote(next)
      patchSession((current) => ({ ...current, activeNoteId: next?.id ?? null }))
    }
  }, [flush, notes, patchSession])

  const setActiveNoteContent = useCallback((content: string) => {
    const current = activeNoteRef.current
    if (!current) return
    const next = { ...current, content, updatedAt: Date.now() }
    activeNoteRef.current = next
    setActiveNote(next)
    scheduleSave()
  }, [scheduleSave])

  const setActiveNoteTitle = useCallback((title: string) => {
    const current = activeNoteRef.current
    if (!current) return
    const next = { ...current, title, updatedAt: Date.now() }
    activeNoteRef.current = next
    setActiveNote(next)
    scheduleSave()
  }, [scheduleSave])

  return { notes, activeNote, setActiveNoteContent, setActiveNoteTitle, createNote, selectNote, deleteNote, flush }
}

function useSlideshowState(session: Session | null, patchSession: (patch: (current: Session) => Session) => void): SlideshowState {
  const [settings, setSettings] = useState<SlideshowSettings>(defaultSlideshowSettings)
  const [images, setImages] = useState<ImageItem[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [status, setStatus] = useState('Open a session to add images.')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsPlaying(false)
    setSettings(session?.slideshow ?? defaultSlideshowSettings)
    setImages((current) => {
      releaseImageItems(current)
      return []
    })
    setError(null)

    if (!session) {
      setStatus('Open a session to add images.')
      return
    }

    async function load() {
      try {
        const source = session!.slideshow.imageSource
        if (source.type === 'none') {
          setStatus('Choose your images or try a sample collection.')
          return
        }

        let nextImages: ImageItem[]
        if (source.type === 'bundled') {
          if (!getBundledCollection(source.collectionId)) {
            if (!cancelled) {
              const message = `The sample collection "${source.collectionId}" is not available in this version.`
              setStatus(message)
              setError(message)
            }
            return
          }
          nextImages = await createImageItemsFromBundledCollection(source.collectionId) ?? []
        } else {
          const assets = await getSessionAssets(session!.id)
          nextImages = await Promise.all(assets.map(createImageItemFromAsset))
          nextImages.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
        }

        if (cancelled) {
          releaseImageItems(nextImages)
          return
        }
        setImages(nextImages)
        if (session!.slideshow.currentIndex >= nextImages.length && session!.slideshow.currentIndex !== 0) {
          const resetIndex = { ...session!.slideshow, currentIndex: 0 }
          setSettings(resetIndex)
          patchSession((stored) => ({ ...stored, slideshow: resetIndex }))
        }
        setStatus(statusForImageSource(source, nextImages.length))
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : 'Could not load session images.'
          setStatus(message)
          setError(message)
        }
      }
    }
    void load()

    return () => {
      cancelled = true
    }
  }, [session?.id])

  useEffect(() => {
    if (!isPlaying || images.length === 0) return
    const intervalId = window.setInterval(() => {
      setSettings((current) => {
        const next = { ...current, currentIndex: getNextImageIndex(current.currentIndex, images.length, current.shuffle) }
        patchSession((stored) => ({ ...stored, slideshow: next }))
        return next
      })
    }, settings.intervalMs)
    return () => window.clearInterval(intervalId)
  }, [images.length, isPlaying, patchSession, settings.intervalMs, settings.shuffle])

  const replaceImages = useCallback(async (files: FileList | File[], folderName: string) => {
    if (!session) return
    const selected = Array.from(files).filter(isSupportedImageFile)
    if (selected.length > sessionLimits.maxImageCount) throw new Error(`A session can contain at most ${sessionLimits.maxImageCount} images.`)

    const assets = await Promise.all(selected.map((file) => createSessionAsset(file, session.id)))
    await replaceSessionAssets(session.id, assets)
    const nextImages = await Promise.all(assets.map(createImageItemFromAsset))
    nextImages.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))

    setIsPlaying(false)
    setImages((current) => {
      releaseImageItems(current)
      return nextImages
    })
    const nextSettings = settingsForSessionAssets(settings, folderName)
    setSettings(nextSettings)
    patchSession((stored) => ({ ...stored, slideshow: nextSettings }))
    setStatus(nextImages.length ? `${folderName} · ${nextImages.length} images` : 'No supported images were selected.')
    setError(null)
  }, [patchSession, session, settings])

  const loadImagesFromHandle = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const files: File[] = []
    for await (const file of readImageFilesFromDirectory(handle)) files.push(file)
    await replaceImages(files, handle.name)
  }, [replaceImages])

  const selectFolder = useCallback(async () => {
    if (!session) return false
    if (!window.showDirectoryPicker) {
      setError('Folder selection is unavailable in this browser. Use the file picker instead.')
      return false
    }
    try {
      const handle = await window.showDirectoryPicker()
      await saveDirectoryHandle(session.id, handle)
      await loadImagesFromHandle(handle)
      return true
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return true
      setError(caught instanceof Error ? caught.message : 'Could not select the folder.')
      return false
    }
  }, [loadImagesFromHandle, session])

  const selectBundledCollection = useCallback(async (collectionId: string) => {
    if (!session) throw new Error('Open a session before selecting images.')
    const collection = getBundledCollection(collectionId)
    if (!collection) {
      const message = `The sample collection "${collectionId}" is not available in this version.`
      setError(message)
      setStatus(message)
      return
    }

    try {
      const nextImages = await createImageItemsFromBundledCollection(collectionId) ?? []
      setIsPlaying(false)
      setImages((current) => {
        releaseImageItems(current)
        return nextImages
      })
      const nextSettings = settingsForBundledCollection(settings, collection.id)
      setSettings(nextSettings)
      patchSession((stored) => ({ ...stored, slideshow: nextSettings }))
      setStatus(statusForImageSource(nextSettings.imageSource, nextImages.length))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the sample collection.')
    }
  }, [patchSession, session, settings])

  const restoreFolder = useCallback(async () => {
    if (!session) return
    const stored = await getDirectoryHandle(session.id)
    if (!stored) return
    try {
      if (!(await ensureReadPermission(stored.handle))) {
        setStatus(`Permission is needed to reopen ${stored.name}.`)
        return
      }
      await loadImagesFromHandle(stored.handle)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reopen the image folder.')
    }
  }, [loadImagesFromHandle, session])

  const resetFolder = useCallback(async () => {
    if (!session) return
    setIsPlaying(false)
    if (settings.imageSource.type === 'session-assets') {
      await replaceSessionAssets(session.id, [])
      await clearDirectoryHandle(session.id)
    }
    setImages((current) => {
      releaseImageItems(current)
      return []
    })
    const nextSettings = settingsForClearedImages(settings)
    setSettings(nextSettings)
    patchSession((stored) => ({ ...stored, slideshow: nextSettings }))
    setStatus('Choose your images or try a sample collection.')
    setError(null)
  }, [patchSession, session, settings])

  const stop = useCallback(() => {
    setIsPlaying(false)
    const next = { ...settings, currentIndex: 0 }
    setSettings(next)
    patchSession((stored) => ({ ...stored, slideshow: next }))
  }, [patchSession, settings])

  const next = useCallback(() => {
    const nextSettings = { ...settings, currentIndex: getNextImageIndex(settings.currentIndex, images.length, settings.shuffle) }
    setSettings(nextSettings)
    patchSession((stored) => ({ ...stored, slideshow: nextSettings }))
  }, [images.length, patchSession, settings])

  const previous = useCallback(() => {
    const nextSettings = { ...settings, currentIndex: images.length ? (settings.currentIndex - 1 + images.length) % images.length : 0 }
    setSettings(nextSettings)
    patchSession((stored) => ({ ...stored, slideshow: nextSettings }))
  }, [images.length, patchSession, settings])

  const updateSettings = useCallback((partial: Partial<SlideshowSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...partial }
      patchSession((stored) => ({ ...stored, slideshow: next }))
      return next
    })
  }, [patchSession])

  return {
    settings, images, isPlaying, status, error, selectFolder, selectBundledCollection,
    importFiles: (files) => replaceImages(files, 'Imported images'), resetFolder, restoreFolder,
    setIsPlaying, stop, next, previous, updateSettings,
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
    setPlaylist(session?.spotify ?? defaultSpotifyPlaylistReference)
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

  const setSessionPlaylist = useCallback((next: SpotifyPlaylistReference) => {
    setPlaylist(next)
    patchSession((current) => ({ ...current, spotify: next }))
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

  const loadPlaylistFromUrl = useCallback(async (url: string) => {
    const id = parseSpotifyPlaylistUrl(url)
    if (!id) throw new Error('Paste a valid Spotify playlist URL or URI.')
    const fresh = await ensureFreshTokens()
    const item = await requestSpotify(() => spotifyFetch<SpotifyPlaylistApiItem>(`/playlists/${id}`, fresh.accessToken))
    const summary = mapPlaylist(item)
    const selected = { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url }
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ context_uri: selected.uri }) }))
    setSessionPlaylist(selected)
    setPlaylists((current) => [summary, ...current.filter((candidate) => candidate.id !== summary.id)])
    setStatus(`Playing ${summary.name}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify, setSessionPlaylist])

  const playPlaylist = useCallback(async (summary?: SpotifyPlaylistSummary) => {
    const selected = summary ? { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url } : playlist
    if (!selected.uri) throw new Error('Choose a playlist first.')
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ context_uri: selected.uri }) }))
    setSessionPlaylist(selected)
    setStatus(`Playing ${selected.name ?? 'playlist'}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, playlist, requestSpotify, setSessionPlaylist])

  const playTrack = useCallback(async (summary: SpotifyTrackSummary) => {
    if (!deviceId) throw new Error('Spotify browser device is not ready yet.')
    const fresh = await ensureFreshTokens()
    await requestSpotify(() => spotifyFetch<void>('/me/player', fresh.accessToken, { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play: false }) }))
    await requestSpotify(() => spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, { method: 'PUT', body: JSON.stringify({ uris: [summary.uri] }) }))
    setStatus(`Playing ${summary.name} by ${summary.artists}.`)
    setError(null)
  }, [deviceId, ensureFreshTokens, requestSpotify])

  const togglePlay = useCallback(async () => {
    const action = getSpotifyPlaybackAction(Boolean(track), playlist.uri)
    if (action === 'load-saved-playlist') {
      await playPlaylist()
      return
    }
    if (action === 'missing-playlist') {
      throw new Error('Load or choose a playlist before starting playback.')
    }

    const player = playerRef.current
    if (!player) throw new Error('Spotify browser device is not ready yet.')
    await player.togglePlay()
  }, [playPlaylist, playlist.uri, track])

  return {
    tokens, playlist, playlists, tracks, track, deviceId, isReady, status, error, login, logout, clearSearchResults, handleCallback, searchPlaylists, searchTracks, loadPlaylistFromUrl, playPlaylist, playTrack,
    togglePlay,
    previousTrack: async () => playerRef.current?.previousTrack(),
    nextTrack: async () => playerRef.current?.nextTrack(),
    setVolume: async (value) => playerRef.current?.setVolume(value),
    seek: async (positionMs) => playerRef.current?.seek(positionMs),
  }
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

async function createSessionAsset(file: File, sessionId: string) {
  if (file.size > sessionLimits.maxImageBytes) throw new Error(`${file.name} exceeds the 25 MB per-image limit.`)
  const mimeType = normaliseImageMimeType(file)
  if (!mimeType) throw new Error(`${file.name} is not a supported image type.`)
  const url = URL.createObjectURL(file)
  const dimensions = await readImageDimensions(url)
  URL.revokeObjectURL(url)
  return {
    id: createId('image'),
    sessionId,
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
