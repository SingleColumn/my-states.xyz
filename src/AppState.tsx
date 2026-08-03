import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ImageItem,
  ImageMetadata,
  Note,
  SlideshowSettings,
  SpotifyPlaylistState,
  SpotifyTokens,
  SpotifyTrackState,
} from './types'
import {
  clearDirectoryHandle,
  clearImageMetadata,
  defaultSlideshowSettings,
  defaultSpotifyPlaylistState,
  deleteNote as deleteStoredNote,
  getDirectoryHandle,
  getNotes,
  loadLastNoteId,
  loadSlideshowSettings,
  loadSpotifyPlaylistState,
  loadSpotifyTokens,
  saveDirectoryHandle,
  saveImageMetadata,
  saveLastNoteId,
  saveNote,
  saveSlideshowSettings,
  saveSpotifyPlaylistState,
  saveSpotifyTokens,
} from './storage'
import { createId } from './utils'
import {
  exchangeSpotifyCode,
  mapPlaylist,
  parseSpotifyPlaylistUrl,
  refreshSpotifyToken,
  SpotifyPlaylistApiItem,
  SpotifyPlaylistSummary,
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
}

interface SlideshowState {
  settings: SlideshowSettings
  images: ImageItem[]
  isPlaying: boolean
  status: string
  error: string | null
  selectFolder(): Promise<boolean>
  importFiles(files: FileList | File[]): Promise<void>
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
  playlist: SpotifyPlaylistState
  playlists: SpotifyPlaylistSummary[]
  track: SpotifyTrackState | null
  deviceId: string | null
  isReady: boolean
  status: string
  error: string | null
  login(): Promise<void>
  logout(): void
  handleCallback(code: string, state: string | null): Promise<void>
  searchPlaylists(query: string): Promise<void>
  loadPlaylistFromUrl(url: string): Promise<void>
  playPlaylist(summary?: SpotifyPlaylistSummary): Promise<void>
  togglePlay(): Promise<void>
  previousTrack(): Promise<void>
  nextTrack(): Promise<void>
  setVolume(value: number): Promise<void>
  seek(positionMs: number): Promise<void>
}

interface AppStateValue {
  notes: NotesState
  slideshow: SlideshowState
  spotify: SpotifyState
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const notes = useNotesState()
  const slideshow = useSlideshowState()
  const spotify = useSpotifyState()

  const value = useMemo(() => ({ notes, slideshow, spotify }), [notes, slideshow, spotify])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState must be used inside AppStateProvider')
  return value
}

function useNotesState(): NotesState {
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const storedNotes = await getNotes()
      if (cancelled) return

      setNotes(storedNotes)
      const lastNoteId = loadLastNoteId()
      const selected = storedNotes.find((note) => note.id === lastNoteId) ?? storedNotes[0] ?? null
      setActiveNote(selected)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeNote) return

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      void saveNote(activeNote)
      setNotes((current) => {
        const withoutCurrent = current.filter((note) => note.id !== activeNote.id)
        return [activeNote, ...withoutCurrent].sort((a, b) => b.updatedAt - a.updatedAt)
      })
      saveLastNoteId(activeNote.id)
    }, 500)

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [activeNote])

  const createNote = useCallback(async () => {
    const now = Date.now()
    const note: Note = {
      id: createId('note'),
      title: 'Untitled note',
      content: '',
      createdAt: now,
      updatedAt: now,
    }

    await saveNote(note)
    setNotes((current) => [note, ...current])
    setActiveNote(note)
    saveLastNoteId(note.id)
  }, [])

  const selectNote = useCallback(
    (id: string) => {
      const note = notes.find((candidate) => candidate.id === id)
      if (note) {
        setActiveNote(note)
        saveLastNoteId(note.id)
      }
    },
    [notes],
  )

  const deleteNote = useCallback(
    async (id: string) => {
      await deleteStoredNote(id)
      const nextNotes = notes.filter((note) => note.id !== id)
      setNotes(nextNotes)

      if (activeNote?.id === id) {
        const next = nextNotes[0] ?? null
        setActiveNote(next)
        saveLastNoteId(next?.id ?? null)
      }
    },
    [activeNote?.id, notes],
  )

  const setActiveNoteContent = useCallback((content: string) => {
    setActiveNote((note) => (note ? { ...note, content, updatedAt: Date.now() } : note))
  }, [])

  const setActiveNoteTitle = useCallback((title: string) => {
    setActiveNote((note) => (note ? { ...note, title, updatedAt: Date.now() } : note))
  }, [])

  return {
    notes,
    activeNote,
    setActiveNoteContent,
    setActiveNoteTitle,
    createNote,
    selectNote,
    deleteNote,
  }
}

function useSlideshowState(): SlideshowState {
  const [settings, setSettings] = useState(loadSlideshowSettings)
  const [images, setImages] = useState<ImageItem[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [status, setStatus] = useState('Select an image folder to begin.')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    saveSlideshowSettings(settings)
  }, [settings])

  useEffect(() => {
    if (!isPlaying || images.length === 0) return

    const intervalId = window.setInterval(() => {
      setSettings((current) => ({
        ...current,
        currentIndex: getNextImageIndex(current.currentIndex, images.length, current.shuffle),
      }))
    }, settings.intervalMs)

    return () => window.clearInterval(intervalId)
  }, [images.length, isPlaying, settings.intervalMs, settings.shuffle])

  useEffect(() => {
    void restoreFolder()
    return () => {
      for (const image of images) URL.revokeObjectURL(image.url)
    }
    // Run once on mount; image URLs are cleaned up when replaced by loadImagesFromHandle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadImagesFromHandle = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      const nextImages: ImageItem[] = []
      let totalFiles = 0

      for await (const file of readImageFilesFromDirectory(handle)) {
        totalFiles += 1
        if (!isSupportedImageFile(file)) continue
        nextImages.push(await createImageItem(file, file.name))
      }

      nextImages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

      setImages((current) => {
        for (const image of current) URL.revokeObjectURL(image.url)
        return nextImages
      })

      const metadata: ImageMetadata[] = nextImages.map(({ name, size, lastModified, width, height }) => ({
        name,
        size,
        lastModified,
        width,
        height,
      }))

      await saveImageMetadata(metadata)

      setSettings((current) => ({
        ...current,
        folderName: handle.name,
        currentIndex: Math.min(current.currentIndex, Math.max(nextImages.length - 1, 0)),
      }))
      setStatus(
        nextImages.length
          ? `${nextImages.length} images loaded from ${handle.name}.`
          : `No supported images found. Browser returned ${totalFiles} files from ${handle.name}.`,
      )
      setError(null)
    },
    [],
  )

  const loadImagesFromFiles = useCallback(async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files)
    const nextImages = (
      await Promise.all(
        selectedFiles
          .filter(isSupportedImageFile)
          .map((file) => createImageItem(file, file.webkitRelativePath || file.name)),
      )
    ).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    setImages((current) => {
      for (const image of current) URL.revokeObjectURL(image.url)
      return nextImages
    })

    const metadata: ImageMetadata[] = nextImages.map(({ name, size, lastModified, width, height }) => ({
      name,
      size,
      lastModified,
      width,
      height,
    }))

    await saveImageMetadata(metadata)

    const folderName = nextImages[0]?.name.includes('/') ? nextImages[0].name.split('/')[0] : 'Imported folder'
    setSettings((current) => ({
      ...current,
      folderName,
      currentIndex: 0,
    }))
    setStatus(
      nextImages.length
        ? `${nextImages.length} images loaded from ${folderName}.`
        : `No supported images found. Browser returned ${selectedFiles.length} files.`,
    )
    setError(null)
  }, [])

  const restoreFolder = useCallback(async () => {
    const stored = await getDirectoryHandle()
    if (!stored) return

    try {
      const permission = await ensureReadPermission(stored.handle)
      if (!permission) {
        setStatus(`Permission needed to reopen ${stored.name}.`)
        return
      }

      await loadImagesFromHandle(stored.handle)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reopen image folder.')
    }
  }, [loadImagesFromHandle])

  const selectFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      setError('This MVP requires Chrome or Edge with File System Access API support.')
      return false
    }

    try {
      setStatus('Choose a folder. The picker may not preview image files.')
      const handle = await window.showDirectoryPicker()
      await saveDirectoryHandle(handle)
      await loadImagesFromHandle(handle)
      return true
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return true
      setError(caught instanceof Error ? caught.message : 'Could not select folder.')
      return false
    }
  }, [loadImagesFromHandle])

  const resetFolder = useCallback(async () => {
    setIsPlaying(false)
    setImages((current) => {
      for (const image of current) URL.revokeObjectURL(image.url)
      return []
    })
    setSettings((current) => ({
      ...current,
      folderName: null,
      currentIndex: 0,
      zoom: 1,
    }))
    setStatus('Select an image folder to begin.')
    setError(null)
    await clearDirectoryHandle()
    await clearImageMetadata()
  }, [])

  const stop = useCallback(() => {
    setIsPlaying(false)
    setSettings((current) => ({ ...current, currentIndex: 0 }))
  }, [])

  const next = useCallback(() => {
    setSettings((current) => ({
      ...current,
      currentIndex: getNextImageIndex(current.currentIndex, images.length, current.shuffle),
    }))
  }, [images.length])

  const previous = useCallback(() => {
    setSettings((current) => ({
      ...current,
      currentIndex: images.length ? (current.currentIndex - 1 + images.length) % images.length : 0,
    }))
  }, [images.length])

  const updateSettings = useCallback((partial: Partial<SlideshowSettings>) => {
    setSettings((current) => ({ ...current, ...partial }))
  }, [])

  return {
    settings,
    images,
    isPlaying,
    status,
    error,
    selectFolder,
    importFiles: loadImagesFromFiles,
    resetFolder,
    restoreFolder,
    setIsPlaying,
    stop,
    next,
    previous,
    updateSettings,
  }
}

function useSpotifyState(): SpotifyState {
  const [tokens, setTokens] = useState<SpotifyTokens | null>(loadSpotifyTokens)
  const [playlist, setPlaylist] = useState<SpotifyPlaylistState>(loadSpotifyPlaylistState)
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([])
  const [track, setTrack] = useState<SpotifyTrackState | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [status, setStatus] = useState('Log in to Spotify to play a playlist.')
  const [error, setError] = useState<string | null>(null)
  const playerRef = useRef<Spotify.Player | null>(null)

  useEffect(() => {
    saveSpotifyTokens(tokens)
  }, [tokens])

  useEffect(() => {
    saveSpotifyPlaylistState(playlist)
  }, [playlist])

  const ensureFreshTokens = useCallback(async () => {
    if (!tokens) throw new Error('Log in to Spotify first.')

    if (tokens.expiresAt - Date.now() > 60_000) {
      return tokens
    }

    const refreshed = await refreshSpotifyToken(tokens)
    setTokens(refreshed)
    return refreshed
  }, [tokens])

  useEffect(() => {
    if (!tokens?.accessToken || playerRef.current) return

    let cancelled = false

    async function initPlayer() {
      try {
        await loadSpotifySdk()
        if (cancelled || !window.Spotify || !tokens?.accessToken) return

        const player = new window.Spotify.Player({
          name: 'Music Images Canvas',
          getOAuthToken: (callback) => callback(tokens.accessToken),
          volume: 0.7,
        })

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
          setTrack({
            title: current.name,
            artist: current.artists.map((artist) => artist.name).join(', '),
            album: current.album.name,
            albumArt: current.album.images[0]?.url ?? null,
            durationMs: state.duration,
            positionMs: state.position,
            paused: state.paused,
          })
        })

        const handleError = (event: Spotify.WebPlaybackError) => {
          setError(event.message)
          setStatus('Spotify playback needs attention.')
        }

        player.addListener('initialization_error', handleError)
        player.addListener('authentication_error', handleError)
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
  }, [tokens?.accessToken])

  const login = useCallback(async () => {
    await startSpotifyLogin()
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
    const nextTokens = await exchangeSpotifyCode(code, state)
    setTokens(nextTokens)
    setStatus('Spotify login complete.')
  }, [])

  const searchPlaylists = useCallback(
    async (query: string) => {
      const fresh = await ensureFreshTokens()
      setPlaylist((current) => ({ ...current, lastSearch: query }))
      if (!query.trim()) {
        setPlaylists([])
        return
      }

      const result = await spotifyFetch<{
        playlists: {
          next: string | null
          items: Array<SpotifyPlaylistApiItem | null>
        }
      }>(`/search?${new URLSearchParams({ q: query, type: 'playlist', limit: '10', offset: '0' }).toString()}`, fresh.accessToken)

      const playlistItems = [...result.playlists.items]
      let next = result.playlists.next
      for (let offset = 10; next && offset < 50; offset += 10) {
        const page = await spotifyFetch<{
          playlists: {
            next: string | null
            items: Array<SpotifyPlaylistApiItem | null>
          }
        }>(`/search?${new URLSearchParams({ q: query, type: 'playlist', limit: '10', offset: String(offset) }).toString()}`, fresh.accessToken)
        playlistItems.push(...page.playlists.items)
        next = page.playlists.next
      }

      const mapped = playlistItems.filter(isSpotifyPlaylistApiItem).map((item) => mapPlaylist(item))
      setPlaylists([...new Map(mapped.map((item) => [item.id, item])).values()])
      setError(null)
    },
    [ensureFreshTokens],
  )

  const loadPlaylistFromUrl = useCallback(
    async (url: string) => {
      const id = parseSpotifyPlaylistUrl(url)
      if (!id) throw new Error('Paste a valid Spotify playlist URL or URI.')

      const fresh = await ensureFreshTokens()
      const item = await spotifyFetch<SpotifyPlaylistApiItem>(`/playlists/${id}`, fresh.accessToken)
      const summary = mapPlaylist(item)
      setPlaylist({
        id: summary.id,
        uri: summary.uri,
        name: summary.name,
        url: summary.url,
        lastSearch: playlist.lastSearch,
      })
      setPlaylists((current) => [summary, ...current.filter((candidate) => candidate.id !== summary.id)])
      setError(null)
    },
    [ensureFreshTokens, playlist.lastSearch],
  )

  const playPlaylist = useCallback(
    async (summary?: SpotifyPlaylistSummary) => {
      const selected = summary
        ? { id: summary.id, uri: summary.uri, name: summary.name, url: summary.url, lastSearch: playlist.lastSearch }
        : playlist

      if (!selected.uri) throw new Error('Choose a playlist first.')
      if (!deviceId) throw new Error('Spotify browser device is not ready yet.')

      const fresh = await ensureFreshTokens()
      await spotifyFetch<void>('/me/player', fresh.accessToken, {
        method: 'PUT',
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false,
        }),
      })

      await spotifyFetch<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, fresh.accessToken, {
        method: 'PUT',
        body: JSON.stringify({ context_uri: selected.uri }),
      })

      setPlaylist(selected)
      setStatus(`Playing ${selected.name ?? 'playlist'}.`)
      setError(null)
    },
    [deviceId, ensureFreshTokens, playlist],
  )

  const togglePlay = useCallback(async () => {
    await playerRef.current?.togglePlay()
  }, [])

  const previousTrack = useCallback(async () => {
    await playerRef.current?.previousTrack()
  }, [])

  const nextTrack = useCallback(async () => {
    await playerRef.current?.nextTrack()
  }, [])

  const setVolume = useCallback(async (value: number) => {
    await playerRef.current?.setVolume(value)
  }, [])

  const seek = useCallback(async (positionMs: number) => {
    await playerRef.current?.seek(positionMs)
  }, [])

  return {
    tokens,
    playlist,
    playlists,
    track,
    deviceId,
    isReady,
    status,
    error,
    login,
    logout,
    handleCallback,
    searchPlaylists,
    loadPlaylistFromUrl,
    playPlaylist,
    togglePlay,
    previousTrack,
    nextTrack,
    setVolume,
    seek,
  }
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

async function createImageItem(file: File, name: string): Promise<ImageItem> {
  const url = URL.createObjectURL(file)
  const dimensions = await readImageDimensions(url)

  return {
    name,
    size: file.size,
    lastModified: file.lastModified,
    url,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  }
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
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
  }
}

async function* readImageFilesFromDirectory(handle: FileSystemDirectoryHandle): AsyncGenerator<File> {
  for await (const [, entry] of handle.entries()) {
    if (entry.kind === 'file') {
      yield entry.getFile()
      continue
    }

    yield* readImageFilesFromDirectory(entry)
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
