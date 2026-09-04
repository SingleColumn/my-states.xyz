import { DBSchema, openDB } from 'idb'
import type {
  CanvasState,
  ImageMetadata,
  Note,
  Panel,
  PanelLayout,
  PanelType,
  Session,
  SessionImage,
  SessionSummary,
  SlideshowSettings,
  SpotifyPlaylistReference,
  SpotifyPlaylistState,
  SpotifyTokens,
} from './types'
import { createId } from './utils'

const DB_VERSION = 2
const SESSION_SCHEMA_VERSION = 2
const MIGRATION_KEY = 'session-migration-v1'
const MIGRATION_PENDING_KEY = 'session-migration-v1-pending'
const ACTIVE_SESSION_KEY = 'active-session-id'

const legacyKeys = {
  canvas: 'mic:canvas',
  slideshow: 'mic:slideshow',
  spotifyTokens: 'mic:spotify-tokens',
  spotifyPlaylist: 'mic:spotify-playlist',
  lastNoteId: 'mic:last-note-id',
}

export const sessionLimits = {
  maxImageCount: 200,
  maxImageBytes: 25 * 1024 * 1024,
  maxTotalImageBytes: 250 * 1024 * 1024,
  maxArchiveBytes: 260 * 1024 * 1024,
} as const

export const DEFAULT_SLIDESHOW_ZOOM = 1.1

export const defaultSlideshowSettings: SlideshowSettings = {
  folderName: null,
  imageSource: { type: 'none' },
  currentIndex: 0,
  intervalMs: 5000,
  transitionMs: 450,
  shuffle: false,
  zoom: DEFAULT_SLIDESHOW_ZOOM,
}

export const defaultSpotifyPlaylistState: SpotifyPlaylistState = {
  id: null,
  uri: null,
  name: null,
  url: null,
  lastSearch: '',
}

export const defaultSpotifyPlaylistReference: SpotifyPlaylistReference = {
  id: null,
  uri: null,
  name: null,
  url: null,
}

interface SessionAssetRecord extends SessionImage {
  blob: Blob
}

interface PreferenceRecord {
  key: string
  value: string
}

interface MigrationVerificationRecord {
  sessionId: string
  name: string
  canvas: CanvasState | null
  slideshow: SlideshowSettings
  spotify: SpotifyPlaylistReference
  activeNoteId: string | null
  noteIds: string[]
  directoryName: string | null
}

export function createDefaultPanels(now = Date.now()): Panel[] {
  return [
    { id: createId('panel'), type: 'spotify', createdAt: now, updatedAt: now, config: { playlist: { ...defaultSpotifyPlaylistReference } } },
    { id: createId('panel'), type: 'slideshow', createdAt: now, updatedAt: now, config: { ...defaultSlideshowSettings } },
    { id: createId('panel'), type: 'notes', createdAt: now, updatedAt: now, config: { activeNoteId: null } },
  ]
}

export interface ImportedSessionContent {
  name: string
  panels?: Panel[]
  canvas: CanvasState | null
  slideshow: SlideshowSettings
  spotify: SpotifyPlaylistReference
  activeNoteSourceId: string | null
  notes: Array<Pick<Note, 'id' | 'title' | 'content' | 'createdAt' | 'updatedAt'>>
  assets: Array<Omit<SessionImage, 'sessionId'> & { blob: Blob }>
}

interface MusicImagesCanvasDb extends DBSchema {
  notes: {
    key: string
    value: Note
    indexes: {
      'by-updated': number
      'by-session-updated': [string, number]
    }
  }
  directoryHandles: {
    key: string
    value: {
      id: string
      sessionId?: string
      panelId?: string
      name: string
      handle: FileSystemDirectoryHandle
    }
  }
  imageMetadata: {
    key: string
    value: {
      id: string
      images: ImageMetadata[]
      updatedAt: number
    }
  }
  sessions: {
    key: string
    value: Session
    indexes: {
      'by-updated': number
    }
  }
  assets: {
    key: string
    value: SessionAssetRecord
    indexes: {
      'by-session': string
    }
  }
  preferences: {
    key: string
    value: PreferenceRecord
  }
  sessionDirectoryHandles: {
    key: string
    value: {
      sessionId: string
      name: string
      handle: FileSystemDirectoryHandle
    }
  }
}

const dbPromise = openDB<MusicImagesCanvasDb>('music-images-canvas', DB_VERSION, {
  upgrade(db, oldVersion, _newVersion, transaction) {
    if (!db.objectStoreNames.contains('notes')) {
      const notes = db.createObjectStore('notes', { keyPath: 'id' })
      notes.createIndex('by-updated', 'updatedAt')
    }

    if (!db.objectStoreNames.contains('directoryHandles')) {
      db.createObjectStore('directoryHandles', { keyPath: 'id' })
    }

    if (!db.objectStoreNames.contains('imageMetadata')) {
      db.createObjectStore('imageMetadata', { keyPath: 'id' })
    }

    if (oldVersion < 2) {
      const notes = transaction.objectStore('notes')
      if (!notes.indexNames.contains('by-session-updated')) {
        notes.createIndex('by-session-updated', ['sessionId', 'updatedAt'])
      }

      const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
      sessions.createIndex('by-updated', 'updatedAt')

      const assets = db.createObjectStore('assets', { keyPath: 'id' })
      assets.createIndex('by-session', 'sessionId')

      db.createObjectStore('preferences', { keyPath: 'key' })
      db.createObjectStore('sessionDirectoryHandles', { keyPath: 'sessionId' })
    }
  },
})

function readLegacyJson<T>(key: string, fallback: T): T {
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function legacyPlaylistReference(): SpotifyPlaylistReference {
  const playlist = readLegacyJson(legacyKeys.spotifyPlaylist, defaultSpotifyPlaylistState)
  return {
    id: playlist.id,
    uri: playlist.uri,
    name: playlist.name,
    url: playlist.url,
  }
}

function makeSession(name: string, initial?: Partial<Session>): Session {
  const now = Date.now()
  return {
    id: createId('session'),
    name: normalizeSessionName(name),
    schemaVersion: SESSION_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    panels: createDefaultPanels(now),
    canvas: null,
    ...initial,
  }
}

export async function initializeSessions() {
  const db = await dbPromise
  const migration = await db.get('preferences', MIGRATION_KEY)

  if (!migration) {
    const pending = await db.get('preferences', MIGRATION_PENDING_KEY)
    let verification = pending ? parseMigrationVerification(pending.value) : null

    if (pending && !verification) {
      throw new Error('The previous session migration cannot be verified. Your original browser data has not been removed.')
    }

    if (!verification) {
      const existingSessions = await db.count('sessions')
      if (!existingSessions) verification = await migrateLegacyState(db)
    }

    if (verification) await verifyMigratedLegacyState(db, verification)

    const tx = db.transaction('preferences', 'readwrite')
    await tx.store.put({ key: MIGRATION_KEY, value: 'complete' })
    await tx.store.delete(MIGRATION_PENDING_KEY)
    await tx.done
  }

  let sessions = await getSessions()
  if (!sessions.length) {
    const session = await createSession('My first session')
    sessions = [session]
  }

  const activePreference = await db.get('preferences', ACTIVE_SESSION_KEY)
  const activeSessionId = sessions.some((session) => session.id === activePreference?.value)
    ? activePreference?.value ?? sessions[0].id
    : sessions[0].id

  if (activePreference?.value !== activeSessionId) {
    await db.put('preferences', { key: ACTIVE_SESSION_KEY, value: activeSessionId })
  }

  return { sessions, activeSessionId }
}

async function migrateLegacyState(db: Awaited<typeof dbPromise>): Promise<MigrationVerificationRecord> {
  const legacyCanvas = readLegacyJson<CanvasState | null>(legacyKeys.canvas, null)
  const legacySlideshow = { ...defaultSlideshowSettings, ...readLegacyJson(legacyKeys.slideshow, defaultSlideshowSettings) }
  const legacyLastNoteId = window.localStorage.getItem(legacyKeys.lastNoteId)
  const legacyNotes = await db.getAll('notes')
  const legacySpotify = legacyPlaylistReference()
  const legacyFolder = await db.get('directoryHandles', 'slideshow')
  const hasLegacyState = Boolean(legacyCanvas || legacyNotes.length || legacySlideshow.folderName || legacySpotify.id)
  const activeNoteId = legacyNotes.some((note) => note.id === legacyLastNoteId) ? legacyLastNoteId : legacyNotes[0]?.id ?? null
  const panels = createDefaultPanels()
  const spotifyPanel = panels.find((panel) => panel.type === 'spotify')!
  const slideshowPanel = panels.find((panel) => panel.type === 'slideshow')!
  const notesPanel = panels.find((panel) => panel.type === 'notes')!
  spotifyPanel.config.playlist = legacySpotify
  slideshowPanel.config = legacySlideshow
  notesPanel.config.activeNoteId = activeNoteId
  const session = makeSession(hasLegacyState ? 'Imported workspace' : 'My first session', { canvas: migrateCanvas(legacyCanvas, panels), panels })
  const verification: MigrationVerificationRecord = {
    sessionId: session.id,
    name: session.name,
    canvas: session.canvas,
    slideshow: slideshowPanel.config,
    spotify: spotifyPanel.config.playlist,
    activeNoteId,
    noteIds: legacyNotes.map((note) => note.id),
    directoryName: legacyFolder?.name ?? null,
  }

  const tx = db.transaction(['sessions', 'notes', 'preferences', 'sessionDirectoryHandles'], 'readwrite')
  await tx.objectStore('sessions').put(session)

  for (const note of legacyNotes) {
    await tx.objectStore('notes').put({ ...note, sessionId: session.id })
  }

  if (legacyFolder) {
    await tx.objectStore('sessionDirectoryHandles').put({
      sessionId: session.id,
      name: legacyFolder.name,
      handle: legacyFolder.handle,
    })
  }

  await tx.objectStore('preferences').put({ key: ACTIVE_SESSION_KEY, value: session.id })
  await tx.objectStore('preferences').put({ key: MIGRATION_PENDING_KEY, value: JSON.stringify(verification) })
  await tx.done
  return verification
}

async function verifyMigratedLegacyState(db: Awaited<typeof dbPromise>, expected: MigrationVerificationRecord) {
  const [session, notes, directory] = await Promise.all([
    db.get('sessions', expected.sessionId),
    db.getAllFromIndex('notes', 'by-session-updated', IDBKeyRange.bound([expected.sessionId, 0], [expected.sessionId, Number.MAX_SAFE_INTEGER])),
    db.get('sessionDirectoryHandles', expected.sessionId),
  ])

  const hasExpectedNotes = notes.length === expected.noteIds.length
    && notes.every((note) => note.sessionId === expected.sessionId && expected.noteIds.includes(note.id))
  const sessionMatches = session
    && session.name === expected.name
    && session.panels.find((panel) => panel.type === 'notes')?.config.activeNoteId === expected.activeNoteId
    && JSON.stringify(session.canvas) === JSON.stringify(expected.canvas)
    && JSON.stringify(session.panels.find((panel) => panel.type === 'slideshow')?.config) === JSON.stringify(expected.slideshow)
    && JSON.stringify(session.panels.find((panel) => panel.type === 'spotify')?.config.playlist) === JSON.stringify(expected.spotify)
  const directoryMatches = expected.directoryName === null
    ? !directory
    : directory?.name === expected.directoryName

  if (!sessionMatches || !hasExpectedNotes || !directoryMatches) {
    throw new Error('The previous session migration could not be verified. Your original browser data has not been removed; reload to retry.')
  }
}

function parseMigrationVerification(value: string): MigrationVerificationRecord | null {
  try {
    const parsed = JSON.parse(value) as Partial<MigrationVerificationRecord>
    if (
      !parsed
      || typeof parsed.sessionId !== 'string'
      || typeof parsed.name !== 'string'
      || !Array.isArray(parsed.noteIds)
      || !parsed.noteIds.every((id) => typeof id === 'string')
      || (parsed.activeNoteId !== null && typeof parsed.activeNoteId !== 'string')
      || (parsed.directoryName !== null && typeof parsed.directoryName !== 'string')
    ) return null
    return parsed as MigrationVerificationRecord
  } catch {
    return null
  }
}

export async function getSessions(): Promise<Session[]> {
  const db = await dbPromise
  const sessions = await db.getAllFromIndex('sessions', 'by-updated')
  const normalized = await Promise.all(sessions.map(async (session) => normalizeAndPersistSession(session, await db.countFromIndex('assets', 'by-session', session.id))))
  return normalized.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getSession(sessionId: string) {
  const db = await dbPromise
  const session = await db.get('sessions', sessionId)
  if (!session) return undefined
  const assetCount = await db.countFromIndex('assets', 'by-session', sessionId)
  return normalizeAndPersistSession(session, assetCount)
}

export async function createSession(name: string) {
  const db = await dbPromise
  const session = makeSession(name)
  await db.put('sessions', session)
  return session
}

export async function saveSession(session: Session) {
  const db = await dbPromise
  const next = enforceSpotifySingleton({ ...session, name: normalizeSessionName(session.name), updatedAt: Date.now() })
  await db.put('sessions', next)
  return next
}

export async function setActiveSessionId(sessionId: string) {
  const db = await dbPromise
  await db.put('preferences', { key: ACTIVE_SESSION_KEY, value: sessionId })
}

export async function deleteSession(sessionId: string) {
  const db = await dbPromise
  const tx = db.transaction(['sessions', 'notes', 'assets', 'sessionDirectoryHandles', 'preferences'], 'readwrite')
  const noteIds = await tx.objectStore('notes').index('by-session-updated').getAllKeys(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]))
  const assetIds = await tx.objectStore('assets').index('by-session').getAllKeys(sessionId)

  await Promise.all([
    ...noteIds.map((id) => tx.objectStore('notes').delete(id)),
    ...assetIds.map((id) => tx.objectStore('assets').delete(id)),
    tx.objectStore('sessions').delete(sessionId),
    tx.objectStore('sessionDirectoryHandles').delete(sessionId),
  ])

  const active = await tx.objectStore('preferences').get(ACTIVE_SESSION_KEY)
  if (active?.value === sessionId) {
    await tx.objectStore('preferences').delete(ACTIVE_SESSION_KEY)
  }
  await tx.done
}

export async function importSessionContent(content: ImportedSessionContent) {
  validateAssets(content.assets)
  const sourceNoteIds = new Set<string>()
  for (const note of content.notes) {
    if (!note.id || sourceNoteIds.has(note.id)) throw new Error('The session bundle contains duplicate note IDs.')
    sourceNoteIds.add(note.id)
  }

  const sourcePanels = enforceSpotifySingletonPanels(content.panels ?? createDefaultPanels())
  const panelIdMap = new Map(sourcePanels.map((panel) => [panel.id, createId('panel')]))
  const importedPanels = sourcePanels.map((panel) => ({ ...panel, id: panelIdMap.get(panel.id)! }))
  const session = makeSession(content.name, {
    panels: importedPanels,
    canvas: migrateCanvas(content.canvas, importedPanels, panelIdMap),
  })
  const hasMultipleSlideshowPanels = (content.panels?.filter((panel) => panel.type === 'slideshow').length ?? 0) > 1
  if (!hasMultipleSlideshowPanels) {
    const slideshowPanel = session.panels.find((panel) => panel.type === 'slideshow')
    if (slideshowPanel) slideshowPanel.config = normalizeSlideshowSettings(content.slideshow, content.assets.length > 0)
    const spotifyPanel = session.panels.find((panel) => panel.type === 'spotify')
    if (spotifyPanel) spotifyPanel.config.playlist = content.spotify
  }
  const noteIdMap = new Map(content.notes.map((note) => [note.id, createId('note')]))
  if (!content.panels || (content.panels.filter((panel) => panel.type === 'notes').length ?? 0) <= 1) {
    const notesPanel = session.panels.find((panel) => panel.type === 'notes')
    if (notesPanel) notesPanel.config.activeNoteId = content.activeNoteSourceId ? noteIdMap.get(content.activeNoteSourceId) ?? null : null
  }

  const tx = (await dbPromise).transaction(['sessions', 'notes', 'assets'], 'readwrite')
  await tx.objectStore('sessions').put(session)

  for (const note of content.notes) {
    await tx.objectStore('notes').put({
      ...note,
      id: noteIdMap.get(note.id) ?? createId('note'),
      sessionId: session.id,
    })
  }

  for (const asset of content.assets) {
    await tx.objectStore('assets').put({
      ...asset,
      id: createId('image'),
      sessionId: session.id,
      ...(asset.panelId && panelIdMap.has(asset.panelId) ? { panelId: panelIdMap.get(asset.panelId)! } : {}),
    })
  }

  await tx.done
  return session
}

export async function getSessionSummaries(): Promise<SessionSummary[]> {
  return (await getSessions()).map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
}

export async function getNotes(sessionId: string) {
  const db = await dbPromise
  const notes = await db.getAllFromIndex('notes', 'by-session-updated', IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]))
  return notes.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveNote(note: Note) {
  const db = await dbPromise
  await db.put('notes', note)
}

export async function deleteNote(id: string) {
  const db = await dbPromise
  await db.delete('notes', id)
}

export async function getSessionAssets(sessionId: string, panelId?: string) {
  const db = await dbPromise
  const assets = await db.getAllFromIndex('assets', 'by-session', sessionId)
  return panelId ? assets.filter((asset) => !asset.panelId || asset.panelId === panelId) : assets
}

export async function saveSessionAssets(sessionId: string, assets: Array<Omit<SessionImage, 'sessionId'> & { blob: Blob }>, panelId?: string) {
  validateAssets(assets)
  const db = await dbPromise
  const tx = db.transaction('assets', 'readwrite')
  for (const asset of assets) {
    await tx.store.put({ ...asset, sessionId, ...(panelId ? { panelId } : {}) })
  }
  await tx.done
}

export async function replaceSessionAssets(sessionId: string, assets: Array<Omit<SessionImage, 'sessionId'> & { blob: Blob }>, panelId?: string) {
  validateAssets(assets)
  const db = await dbPromise
  const tx = db.transaction('assets', 'readwrite')
  const existing = await tx.store.index('by-session').getAll(sessionId)
  const existingIds = existing.filter((asset) => !panelId || !asset.panelId || asset.panelId === panelId).map((asset) => asset.id)
  await Promise.all(existingIds.map((id) => tx.store.delete(id)))
  for (const asset of assets) {
    await tx.store.put({ ...asset, sessionId, ...(panelId ? { panelId } : {}) })
  }
  await tx.done
}

export async function saveDirectoryHandle(sessionId: string, handle: FileSystemDirectoryHandle) {
  const db = await dbPromise
  await db.put('sessionDirectoryHandles', { sessionId, name: handle.name, handle })
}

export async function getDirectoryHandle(sessionId: string) {
  const db = await dbPromise
  return db.get('sessionDirectoryHandles', sessionId)
}

export async function clearDirectoryHandle(sessionId: string) {
  const db = await dbPromise
  await db.delete('sessionDirectoryHandles', sessionId)
}

export function loadSpotifyTokens() {
  return readLegacyJson<SpotifyTokens | null>(legacyKeys.spotifyTokens, null)
}

export function saveSpotifyTokens(tokens: SpotifyTokens | null) {
  if (!tokens) {
    window.localStorage.removeItem(legacyKeys.spotifyTokens)
    return
  }
  window.localStorage.setItem(legacyKeys.spotifyTokens, JSON.stringify(tokens))
}

function validateAssets(assets: Array<Omit<SessionImage, 'sessionId'> & { blob: Blob }>) {
  if (assets.length > sessionLimits.maxImageCount) {
    throw new Error(`A session can contain at most ${sessionLimits.maxImageCount} images.`)
  }

  let total = 0
  for (const asset of assets) {
    if (asset.blob.size > sessionLimits.maxImageBytes) {
      throw new Error(`${asset.filename} exceeds the ${formatBytes(sessionLimits.maxImageBytes)} per-image limit.`)
    }
    total += asset.blob.size
  }

  if (total > sessionLimits.maxTotalImageBytes) {
    throw new Error(`Images exceed the ${formatBytes(sessionLimits.maxTotalImageBytes)} per-session limit.`)
  }
}

export function normalizeSlideshowSettings(
  slideshow: SlideshowSettings | (Omit<SlideshowSettings, 'imageSource'> & { imageSource?: unknown }),
  hasSessionAssets: boolean,
): SlideshowSettings {
  const candidate = slideshow.imageSource
  let imageSource: SlideshowSettings['imageSource']
  if (candidate && typeof candidate === 'object' && 'type' in candidate) {
    const sourceRecord = candidate as Record<string, unknown>
    const type = sourceRecord.type
    if (type === 'session-assets') imageSource = { type: 'session-assets' }
    else if (type === 'bundled' && typeof sourceRecord.collectionId === 'string') {
      imageSource = { type: 'bundled', collectionId: sourceRecord.collectionId }
    } else imageSource = { type: 'none' }
  } else {
    imageSource = hasSessionAssets ? { type: 'session-assets' } : { type: 'none' }
  }
  return { ...defaultSlideshowSettings, ...slideshow, imageSource }
}

async function normalizeAndPersistSession(raw: Session, assetCount: number): Promise<Session> {
  const legacy = raw as Session & {
    activeNoteId?: string | null
    slideshow?: SlideshowSettings
    spotify?: SpotifyPlaylistReference
  }
  if (raw.schemaVersion >= SESSION_SCHEMA_VERSION && Array.isArray(raw.panels)) {
    const normalized = enforceSpotifySingleton(raw)
    const slideshow = normalized.panels.find((panel) => panel.type === 'slideshow')
    if (slideshow) slideshow.config = normalizeSlideshowSettings(slideshow.config, assetCount > 0)
    if (normalized !== raw) await (await dbPromise).put('sessions', normalized)
    return normalized
  }

  const panels = createDefaultPanels()
  const spotify = panels.find((panel) => panel.type === 'spotify')!
  const slideshow = panels.find((panel) => panel.type === 'slideshow')!
  const notes = panels.find((panel) => panel.type === 'notes')!
  spotify.config.playlist = legacy.spotify ?? defaultSpotifyPlaylistReference
  slideshow.config = normalizeSlideshowSettings(legacy.slideshow ?? defaultSlideshowSettings, assetCount > 0)
  notes.config.activeNoteId = legacy.activeNoteId ?? null
  const migrated: Session = {
    id: raw.id,
    name: raw.name,
    schemaVersion: SESSION_SCHEMA_VERSION,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    panels,
    canvas: migrateCanvas(raw.canvas, panels),
  }
  const db = await dbPromise
  await db.put('sessions', migrated)
  return migrated
}

function enforceSpotifySingleton(session: Session): Session {
  const panels = enforceSpotifySingletonPanels(session.panels)
  if (panels.length === session.panels.length) return session
  const retainedIds = new Set(panels.map((panel) => panel.id))
  return {
    ...session,
    panels,
    canvas: session.canvas ? { ...session.canvas, panels: session.canvas.panels.filter((layout) => retainedIds.has(layout.panelId)) } : null,
  }
}

function enforceSpotifySingletonPanels(panels: Panel[]): Panel[] {
  let spotifySeen = false
  return panels.filter((panel) => {
    if (panel.type !== 'spotify') return true
    if (spotifySeen) return false
    spotifySeen = true
    return true
  })
}

const panelDirectoryKey = (sessionId: string, panelId: string) => `${sessionId}:${panelId}`

export async function savePanelDirectoryHandle(sessionId: string, panelId: string, handle: FileSystemDirectoryHandle) {
  const db = await dbPromise
  await db.put('directoryHandles', { id: panelDirectoryKey(sessionId, panelId), sessionId, panelId, name: handle.name, handle })
}

export async function getPanelDirectoryHandle(sessionId: string, panelId: string) {
  const db = await dbPromise
  return db.get('directoryHandles', panelDirectoryKey(sessionId, panelId))
}

export async function clearPanelDirectoryHandle(sessionId: string, panelId: string) {
  const db = await dbPromise
  await db.delete('directoryHandles', panelDirectoryKey(sessionId, panelId))
}

function migrateCanvas(canvas: CanvasState | null, panels: Panel[], panelIdMap = new Map<string, string>()): CanvasState | null {
  if (!canvas) return null
  const byType = new Map<PanelType, string>(panels.map((panel) => [panel.type, panel.id]))
  return {
    camera: canvas.camera,
    panels: canvas.panels.flatMap((layout) => {
      const legacyType = (layout as PanelLayout & { panelType?: PanelType }).panelType
      const panelId = layout.panelId ? (panelIdMap.get(layout.panelId) ?? layout.panelId) : (legacyType ? byType.get(legacyType) : undefined)
      return panelId ? [{
        panelId,
        x: layout.x,
        y: layout.y,
        w: layout.w,
        h: layout.h,
        ...(typeof layout.rotation === 'number' && Number.isFinite(layout.rotation) ? { rotation: layout.rotation } : {}),
        ...(typeof layout.order === 'number' && Number.isFinite(layout.order) ? { order: layout.order } : {}),
      }] : []
    }),
  }
}

function normalizeSessionName(name: string) {
  return name.trim().slice(0, 80) || 'Untitled session'
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}
