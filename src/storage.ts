import { DBSchema, openDB } from 'idb'
import type {
  CanvasState,
  ImageMetadata,
  Note,
  Panel,
  PanelLayout,
  PanelType,
  Moment,
  MomentImage,
  MomentSummary,
  SlideshowSettings,
  SpotifyPlaylistReference,
  SpotifyPlaylistState,
  SpotifyTokens,
} from './types'
import { createId } from './utils'

const DB_VERSION = 2
const MOMENT_SCHEMA_VERSION = 2
// Moments were called sessions when these keys, the store and index names below, and the
// createId('session') prefix were first persisted. They keep the old spelling so existing
// browser data keeps loading; only the vocabulary in code and UI changed.
const MIGRATION_KEY = 'session-migration-v1'
const MIGRATION_PENDING_KEY = 'session-migration-v1-pending'
const ACTIVE_MOMENT_KEY = 'active-session-id'

const legacyKeys = {
  canvas: 'mic:canvas',
  slideshow: 'mic:slideshow',
  spotifyTokens: 'mic:spotify-tokens',
  spotifyPlaylist: 'mic:spotify-playlist',
  lastNoteId: 'mic:last-note-id',
}

export const momentLimits = {
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

interface MomentAssetRecord extends MomentImage {
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

export function createPanel(type: PanelType, now = Date.now()): Panel {
  if (type === 'spotify') {
    return { id: createId('panel'), type, createdAt: now, updatedAt: now, config: { playlist: { ...defaultSpotifyPlaylistReference } } }
  }
  if (type === 'slideshow') {
    return { id: createId('panel'), type, createdAt: now, updatedAt: now, config: { ...defaultSlideshowSettings, imageSource: { ...defaultSlideshowSettings.imageSource } } }
  }
  return { id: createId('panel'), type, createdAt: now, updatedAt: now, config: { activeNoteId: null } }
}

export function createDefaultPanels(now = Date.now()): Panel[] {
  return [createPanel('spotify', now), createPanel('slideshow', now), createPanel('notes', now)]
}

export interface ImportedMomentContent {
  name: string
  panels?: Panel[]
  canvas: CanvasState | null
  slideshow: SlideshowSettings
  spotify: SpotifyPlaylistReference
  activeNoteSourceId: string | null
  notes: Array<Pick<Note, 'id' | 'title' | 'content' | 'createdAt' | 'updatedAt'>>
  assets: Array<Omit<MomentImage, 'sessionId'> & { blob: Blob }>
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
    value: Moment
    indexes: {
      'by-updated': number
    }
  }
  assets: {
    key: string
    value: MomentAssetRecord
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

      const moments = db.createObjectStore('sessions', { keyPath: 'id' })
      moments.createIndex('by-updated', 'updatedAt')

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

function makeMoment(name: string, initial?: Partial<Moment>): Moment {
  const now = Date.now()
  return {
    id: createId('session'),
    name: normalizeMomentName(name),
    schemaVersion: MOMENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    panels: createDefaultPanels(now),
    canvas: null,
    ...initial,
  }
}

export async function initializeMoments() {
  const db = await dbPromise
  const migration = await db.get('preferences', MIGRATION_KEY)

  if (!migration) {
    const pending = await db.get('preferences', MIGRATION_PENDING_KEY)
    let verification = pending ? parseMigrationVerification(pending.value) : null

    if (pending && !verification) {
      throw new Error('Your earlier data could not be upgraded into a moment. Your original browser data has not been removed.')
    }

    if (!verification) {
      const existingMoments = await db.count('sessions')
      if (!existingMoments) verification = await migrateLegacyState(db)
    }

    if (verification) await verifyMigratedLegacyState(db, verification)

    const tx = db.transaction('preferences', 'readwrite')
    await tx.store.put({ key: MIGRATION_KEY, value: 'complete' })
    await tx.store.delete(MIGRATION_PENDING_KEY)
    await tx.done
  }

  let moments = await getMoments()
  if (!moments.length) {
    const moment = await createMoment('My first moment')
    moments = [moment]
  }

  const activePreference = await db.get('preferences', ACTIVE_MOMENT_KEY)
  const activeMomentId = moments.some((moment) => moment.id === activePreference?.value)
    ? activePreference?.value ?? moments[0].id
    : moments[0].id

  if (activePreference?.value !== activeMomentId) {
    await db.put('preferences', { key: ACTIVE_MOMENT_KEY, value: activeMomentId })
  }

  return { moments, activeMomentId }
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
  const moment = makeMoment(hasLegacyState ? 'Imported workspace' : 'My first moment', { canvas: migrateCanvas(legacyCanvas, panels), panels })
  const verification: MigrationVerificationRecord = {
    sessionId: moment.id,
    name: moment.name,
    canvas: moment.canvas,
    slideshow: slideshowPanel.config,
    spotify: spotifyPanel.config.playlist,
    activeNoteId,
    noteIds: legacyNotes.map((note) => note.id),
    directoryName: legacyFolder?.name ?? null,
  }

  const tx = db.transaction(['sessions', 'notes', 'preferences', 'sessionDirectoryHandles'], 'readwrite')
  await tx.objectStore('sessions').put(moment)

  for (const note of legacyNotes) {
    await tx.objectStore('notes').put({ ...note, sessionId: moment.id })
  }

  if (legacyFolder) {
    await tx.objectStore('sessionDirectoryHandles').put({
      sessionId: moment.id,
      name: legacyFolder.name,
      handle: legacyFolder.handle,
    })
  }

  await tx.objectStore('preferences').put({ key: ACTIVE_MOMENT_KEY, value: moment.id })
  await tx.objectStore('preferences').put({ key: MIGRATION_PENDING_KEY, value: JSON.stringify(verification) })
  await tx.done
  return verification
}

async function verifyMigratedLegacyState(db: Awaited<typeof dbPromise>, expected: MigrationVerificationRecord) {
  const [moment, notes, directory] = await Promise.all([
    db.get('sessions', expected.sessionId),
    db.getAllFromIndex('notes', 'by-session-updated', IDBKeyRange.bound([expected.sessionId, 0], [expected.sessionId, Number.MAX_SAFE_INTEGER])),
    db.get('sessionDirectoryHandles', expected.sessionId),
  ])

  const hasExpectedNotes = notes.length === expected.noteIds.length
    && notes.every((note) => note.sessionId === expected.sessionId && expected.noteIds.includes(note.id))
  const momentMatches = moment
    && moment.name === expected.name
    && moment.panels.find((panel) => panel.type === 'notes')?.config.activeNoteId === expected.activeNoteId
    && JSON.stringify(moment.canvas) === JSON.stringify(expected.canvas)
    && JSON.stringify(moment.panels.find((panel) => panel.type === 'slideshow')?.config) === JSON.stringify(expected.slideshow)
    && JSON.stringify(moment.panels.find((panel) => panel.type === 'spotify')?.config.playlist) === JSON.stringify(expected.spotify)
  const directoryMatches = expected.directoryName === null
    ? !directory
    : directory?.name === expected.directoryName

  if (!momentMatches || !hasExpectedNotes || !directoryMatches) {
    throw new Error('Your earlier data could not be upgraded into a moment. Your original browser data has not been removed; reload to retry.')
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

export async function getMoments(): Promise<Moment[]> {
  const db = await dbPromise
  const moments = await db.getAllFromIndex('sessions', 'by-updated')
  const normalized = await Promise.all(moments.map(async (moment) => normalizeAndPersistMoment(moment, await db.countFromIndex('assets', 'by-session', moment.id))))
  return normalized.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getMoment(momentId: string) {
  const db = await dbPromise
  const moment = await db.get('sessions', momentId)
  if (!moment) return undefined
  const assetCount = await db.countFromIndex('assets', 'by-session', momentId)
  return normalizeAndPersistMoment(moment, assetCount)
}

export async function createMoment(name: string) {
  const db = await dbPromise
  const moment = makeMoment(name)
  await db.put('sessions', moment)
  return moment
}

export async function saveMoment(moment: Moment) {
  const db = await dbPromise
  const next = enforceSpotifySingleton({ ...moment, name: normalizeMomentName(moment.name), updatedAt: Date.now() })
  await db.put('sessions', next)
  return next
}

export async function setActiveMomentId(momentId: string) {
  const db = await dbPromise
  await db.put('preferences', { key: ACTIVE_MOMENT_KEY, value: momentId })
}

export async function deleteMoment(momentId: string) {
  const db = await dbPromise
  const tx = db.transaction(['sessions', 'notes', 'assets', 'sessionDirectoryHandles', 'preferences'], 'readwrite')
  const noteIds = await tx.objectStore('notes').index('by-session-updated').getAllKeys(IDBKeyRange.bound([momentId, 0], [momentId, Number.MAX_SAFE_INTEGER]))
  const assetIds = await tx.objectStore('assets').index('by-session').getAllKeys(momentId)

  await Promise.all([
    ...noteIds.map((id) => tx.objectStore('notes').delete(id)),
    ...assetIds.map((id) => tx.objectStore('assets').delete(id)),
    tx.objectStore('sessions').delete(momentId),
    tx.objectStore('sessionDirectoryHandles').delete(momentId),
  ])

  const active = await tx.objectStore('preferences').get(ACTIVE_MOMENT_KEY)
  if (active?.value === momentId) {
    await tx.objectStore('preferences').delete(ACTIVE_MOMENT_KEY)
  }
  await tx.done
}

export async function importMomentContent(content: ImportedMomentContent) {
  validateAssets(content.assets)
  const sourceNoteIds = new Set<string>()
  for (const note of content.notes) {
    if (!note.id || sourceNoteIds.has(note.id)) throw new Error('The moment bundle contains duplicate note IDs.')
    sourceNoteIds.add(note.id)
  }

  const sourcePanels = enforceSpotifySingletonPanels(content.panels ?? createDefaultPanels())
  const panelIdMap = new Map(sourcePanels.map((panel) => [panel.id, createId('panel')]))
  const importedPanels = sourcePanels.map((panel) => ({ ...panel, id: panelIdMap.get(panel.id)! }))
  const moment = makeMoment(content.name, {
    panels: importedPanels,
    canvas: migrateCanvas(content.canvas, importedPanels, panelIdMap),
  })
  const hasMultipleSlideshowPanels = (content.panels?.filter((panel) => panel.type === 'slideshow').length ?? 0) > 1
  if (!hasMultipleSlideshowPanels) {
    const slideshowPanel = moment.panels.find((panel) => panel.type === 'slideshow')
    if (slideshowPanel) slideshowPanel.config = normalizeSlideshowSettings(content.slideshow, content.assets.length > 0)
    const spotifyPanel = moment.panels.find((panel) => panel.type === 'spotify')
    if (spotifyPanel) spotifyPanel.config.playlist = content.spotify
  }
  const noteIdMap = new Map(content.notes.map((note) => [note.id, createId('note')]))
  if (!content.panels || (content.panels.filter((panel) => panel.type === 'notes').length ?? 0) <= 1) {
    const notesPanel = moment.panels.find((panel) => panel.type === 'notes')
    if (notesPanel) notesPanel.config.activeNoteId = content.activeNoteSourceId ? noteIdMap.get(content.activeNoteSourceId) ?? null : null
  }

  const tx = (await dbPromise).transaction(['sessions', 'notes', 'assets'], 'readwrite')
  await tx.objectStore('sessions').put(moment)

  for (const note of content.notes) {
    await tx.objectStore('notes').put({
      ...note,
      id: noteIdMap.get(note.id) ?? createId('note'),
      sessionId: moment.id,
    })
  }

  for (const asset of content.assets) {
    await tx.objectStore('assets').put({
      ...asset,
      id: createId('image'),
      sessionId: moment.id,
      ...(asset.panelId && panelIdMap.has(asset.panelId) ? { panelId: panelIdMap.get(asset.panelId)! } : {}),
    })
  }

  await tx.done
  return moment
}

export async function getMomentSummaries(): Promise<MomentSummary[]> {
  return (await getMoments()).map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
}

export async function getNotes(momentId: string) {
  const db = await dbPromise
  const notes = await db.getAllFromIndex('notes', 'by-session-updated', IDBKeyRange.bound([momentId, 0], [momentId, Number.MAX_SAFE_INTEGER]))
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

export async function getMomentAssets(momentId: string, panelId?: string) {
  const db = await dbPromise
  const assets = await db.getAllFromIndex('assets', 'by-session', momentId)
  return panelId ? assets.filter((asset) => !asset.panelId || asset.panelId === panelId) : assets
}

export async function saveMomentAssets(momentId: string, assets: Array<Omit<MomentImage, 'sessionId'> & { blob: Blob }>, panelId?: string) {
  validateAssets(assets)
  const db = await dbPromise
  const tx = db.transaction('assets', 'readwrite')
  for (const asset of assets) {
    await tx.store.put({ ...asset, sessionId: momentId, ...(panelId ? { panelId } : {}) })
  }
  await tx.done
}

export async function replaceMomentAssets(momentId: string, assets: Array<Omit<MomentImage, 'sessionId'> & { blob: Blob }>, panelId?: string) {
  validateAssets(assets)
  const db = await dbPromise
  const tx = db.transaction('assets', 'readwrite')
  const existing = await tx.store.index('by-session').getAll(momentId)
  const existingIds = existing.filter((asset) => !panelId || !asset.panelId || asset.panelId === panelId).map((asset) => asset.id)
  await Promise.all(existingIds.map((id) => tx.store.delete(id)))
  for (const asset of assets) {
    await tx.store.put({ ...asset, sessionId: momentId, ...(panelId ? { panelId } : {}) })
  }
  await tx.done
}

export async function saveDirectoryHandle(momentId: string, handle: FileSystemDirectoryHandle) {
  const db = await dbPromise
  await db.put('sessionDirectoryHandles', { sessionId: momentId, name: handle.name, handle })
}

export async function getDirectoryHandle(momentId: string) {
  const db = await dbPromise
  return db.get('sessionDirectoryHandles', momentId)
}

export async function clearDirectoryHandle(momentId: string) {
  const db = await dbPromise
  await db.delete('sessionDirectoryHandles', momentId)
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

function validateAssets(assets: Array<Omit<MomentImage, 'sessionId'> & { blob: Blob }>) {
  if (assets.length > momentLimits.maxImageCount) {
    throw new Error(`A moment can contain at most ${momentLimits.maxImageCount} images.`)
  }

  let total = 0
  for (const asset of assets) {
    if (asset.blob.size > momentLimits.maxImageBytes) {
      throw new Error(`${asset.filename} exceeds the ${formatBytes(momentLimits.maxImageBytes)} per-image limit.`)
    }
    total += asset.blob.size
  }

  if (total > momentLimits.maxTotalImageBytes) {
    throw new Error(`Images exceed the ${formatBytes(momentLimits.maxTotalImageBytes)} per-moment limit.`)
  }
}

export function normalizeSlideshowSettings(
  slideshow: SlideshowSettings | (Omit<SlideshowSettings, 'imageSource'> & { imageSource?: unknown }),
  hasMomentAssets: boolean,
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
    imageSource = hasMomentAssets ? { type: 'session-assets' } : { type: 'none' }
  }
  return { ...defaultSlideshowSettings, ...slideshow, imageSource }
}

async function normalizeAndPersistMoment(raw: Moment, assetCount: number): Promise<Moment> {
  const legacy = raw as Moment & {
    activeNoteId?: string | null
    slideshow?: SlideshowSettings
    spotify?: SpotifyPlaylistReference
  }
  if (raw.schemaVersion >= MOMENT_SCHEMA_VERSION && Array.isArray(raw.panels)) {
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
  const migrated: Moment = {
    id: raw.id,
    name: raw.name,
    schemaVersion: MOMENT_SCHEMA_VERSION,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    panels,
    canvas: migrateCanvas(raw.canvas, panels),
  }
  const db = await dbPromise
  await db.put('sessions', migrated)
  return migrated
}

function enforceSpotifySingleton(moment: Moment): Moment {
  const panels = enforceSpotifySingletonPanels(moment.panels)
  if (panels.length === moment.panels.length) return moment
  const retainedIds = new Set(panels.map((panel) => panel.id))
  return {
    ...moment,
    panels,
    canvas: moment.canvas ? { ...moment.canvas, panels: moment.canvas.panels.filter((layout) => retainedIds.has(layout.panelId)) } : null,
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

const panelDirectoryKey = (momentId: string, panelId: string) => `${momentId}:${panelId}`

export async function savePanelDirectoryHandle(momentId: string, panelId: string, handle: FileSystemDirectoryHandle) {
  const db = await dbPromise
  await db.put('directoryHandles', { id: panelDirectoryKey(momentId, panelId), sessionId: momentId, panelId, name: handle.name, handle })
}

export async function getPanelDirectoryHandle(momentId: string, panelId: string) {
  const db = await dbPromise
  return db.get('directoryHandles', panelDirectoryKey(momentId, panelId))
}

export async function clearPanelDirectoryHandle(momentId: string, panelId: string) {
  const db = await dbPromise
  await db.delete('directoryHandles', panelDirectoryKey(momentId, panelId))
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

function normalizeMomentName(name: string) {
  return name.trim().slice(0, 80) || 'Untitled moment'
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}
