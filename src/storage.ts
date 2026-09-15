import { DBSchema, deleteDB, openDB } from 'idb'
import type {
  CanvasState,
  Moment,
  MomentDraft,
  MomentImage,
  MomentSummary,
  Note,
  Panel,
  PanelType,
  SpotifyTokens,
} from './types'
import { createId } from './utils'
import { PANEL_TYPES, getPanelDefinition } from './panelRegistry'
import { normalizeDraftPanel } from './panelInput'
import { documentFromDraft } from './panelStore'
import { MOMENT_SCHEMA_VERSION } from './momentSchema'
import { DEFAULT_THEME_ID, isBuiltInThemeId } from './themes/registry'
import type { AppearanceSettings, StoredTheme, ThemeDefinition, ThemeModePreference } from './themes/types'
export { MOMENT_SCHEMA_VERSION } from './momentSchema'
export { normalizeSlideshowSettings } from './panelRegistry'

export { DEFAULT_SLIDESHOW_ZOOM, defaultSlideshowSettings, defaultSpotifyPlaylistReference } from './panelRegistry'

/**
 * The my-states database. Version 1 (2026-09-13) read nothing written by
 * earlier builds: the decision was taken that saved work from before this
 * schema does not carry over, so there is no upgrade path from the earlier
 * `music-images-canvas` database, and a rollback finds that database exactly
 * as it left it (unless this build has already removed it, below).
 *
 * Version 2 (2026-09-15) adds the `themes` store and changes nothing else:
 * every version-1 store and record is kept as it was. A version-1 build
 * opening this database afterwards is refused by IndexedDB with a
 * VersionError, which the handler below turns into a message; nothing is
 * lost, but that build cannot read it.
 */
const DB_NAME = 'my-states'
const DB_VERSION = 2
const ACTIVE_MOMENT_KEY = 'active-moment-id'
const GLOBAL_THEME_KEY = 'global-theme-id'
const THEME_MODE_KEY = 'theme-mode-preference'
// Named before the app was. Kept so a Spotify login survives this build.
const SPOTIFY_TOKENS_KEY = 'mic:spotify-tokens'

/** What earlier builds left in the browser, removed once by this one. */
const previousGeneration = {
  database: 'music-images-canvas',
  localStorageKeys: ['mic:canvas', 'mic:slideshow', 'mic:spotify-playlist', 'mic:last-note-id'],
}

export const momentLimits = {
  maxImageCount: 200,
  maxImageBytes: 25 * 1024 * 1024,
  maxTotalImageBytes: 250 * 1024 * 1024,
  maxArchiveBytes: 260 * 1024 * 1024,
} as const

interface MomentAssetRecord extends MomentImage {
  blob: Blob
}

interface PreferenceRecord {
  key: string
  value: string
}

export function createPanel<Type extends PanelType>(type: Type): Panel<Type> {
  return { id: createId('panel'), type, config: getPanelDefinition(type).createConfig(), visible: true, focusView: false } as Panel<Type>
}

/** One of each kind, in the registry's order. */
export function createDefaultPanels(): Panel[] {
  return PANEL_TYPES.map((type) => createPanel(type))
}

export interface ImportedMomentContent {
  name: string
  /** The theme the archive pinned, installed or not; see `Moment.themeId`. */
  themeId?: string
  panels: Panel[]
  canvas: CanvasState | null
  notes: Array<Pick<Note, 'id' | 'title' | 'content' | 'createdAt' | 'updatedAt'>>
  assets: Array<Omit<MomentImage, 'momentId'> & { blob: Blob }>
}

interface MyStatesDb extends DBSchema {
  moments: {
    key: string
    value: Moment
    indexes: {
      'by-updated': number
    }
  }
  notes: {
    key: string
    value: Note
    indexes: {
      'by-moment-updated': [string, number]
    }
  }
  assets: {
    key: string
    value: MomentAssetRecord
    indexes: {
      'by-moment': string
    }
  }
  directoryHandles: {
    key: string
    value: {
      id: string
      momentId: string
      panelId: string
      name: string
      handle: FileSystemDirectoryHandle
    }
    indexes: {
      'by-moment': string
    }
  }
  preferences: {
    key: string
    value: PreferenceRecord
  }
  themes: {
    key: string
    value: StoredTheme
  }
}

let storageStatus: string | null = null
const storageStatusListeners = new Set<(status: string | null) => void>()
export const getStorageStatus = () => storageStatus
export function subscribeStorageStatus(listener: (status: string | null) => void) {
  storageStatusListeners.add(listener)
  listener(storageStatus)
  return () => { storageStatusListeners.delete(listener) }
}
function reportStorageStatus(status: string | null) {
  storageStatus = status
  storageStatusListeners.forEach((listener) => listener(status))
}

const dbPromise = openDB<MyStatesDb>(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('moments', { keyPath: 'id' }).createIndex('by-updated', 'updatedAt')
      db.createObjectStore('notes', { keyPath: 'id' }).createIndex('by-moment-updated', ['momentId', 'updatedAt'])
      db.createObjectStore('assets', { keyPath: 'id' }).createIndex('by-moment', 'momentId')
      db.createObjectStore('directoryHandles', { keyPath: 'id' }).createIndex('by-moment', 'momentId')
      db.createObjectStore('preferences', { keyPath: 'key' })
    }
    if (oldVersion < 2) {
      db.createObjectStore('themes', { keyPath: 'id' })
    }
  },
  blocking() {
    // A newer build in another tab is waiting to upgrade the database. Do
    // not close automatically: this page may have unsaved edits.
    reportStorageStatus('Another my-states version is waiting. Save or export your work here, then close this tab.')
  },
  terminated() {
    reportStorageStatus('The connection to your saved work was interrupted. Keep this tab open and export your work if possible.')
  },
})
void dbPromise.then(() => reportStorageStatus(null), (error: unknown) => {
  reportStorageStatus(error instanceof DOMException && error.name === 'VersionError'
    ? 'Your saved work needs a newer version of my-states. Open the latest version; do not clear your browser data.'
    : 'Could not open your saved work. Your browser data has not been removed.')
})

/**
 * Best effort, never awaited by anything the user waits on: the earlier
 * database can hold hundreds of megabytes of image bytes, and an old tab
 * that still has it open simply delays the deletion until it closes.
 */
function discardPreviousGeneration() {
  for (const key of previousGeneration.localStorageKeys) window.localStorage.removeItem(key)
  void deleteDB(previousGeneration.database).catch(() => {})
}

function readJson<T>(key: string, fallback: T): T {
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * A moment has its document from creation: the draft (a new moment's
 * defaults, or an imported archive) is normalised, then built into a real
 * tldraw document directly, with no editor and no intermediate stored
 * shape. The canvas loads it exactly as it would one of its own saves.
 */
function makeMoment(name: string, draft: MomentDraft = { panels: createDefaultPanels(), canvas: null }, themeId?: string): Moment {
  const now = Date.now()
  const normalized = { ...draft, panels: draft.panels.map(normalizeDraftPanel) }
  return {
    id: createId('moment'),
    name: normalizeMomentName(name),
    schemaVersion: MOMENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    camera: normalized.canvas?.camera ?? null,
    document: documentFromDraft(normalized),
    ...withThemeId(themeId),
  }
}

/** `themeId` is present only when set: a moment that follows the global theme stays byte-identical to one written before themes existed. */
function withThemeId(themeId: string | null | undefined): Pick<Moment, 'themeId'> {
  return themeId ? { themeId } : {}
}

let initialization: Promise<{ moments: MomentSummary[]; activeMomentId: string }> | null = null

/**
 * Runs once per page. The work below is check-then-create, and React's
 * development double-invoke of effects (or two callers in one page) would
 * otherwise both find no moments and both create "A new moment". One
 * promise is shared; a failure clears it so a reload can retry.
 */
export function initializeMoments() {
  if (!initialization) {
    initialization = runInitialization().catch((error) => {
      initialization = null
      throw error
    })
  }
  return initialization
}

async function runInitialization() {
  const db = await dbPromise
  discardPreviousGeneration()

  let moments = await getMomentSummaries()
  if (!moments.length) {
    const moment = await createMoment('A new moment')
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

export async function getMoment(momentId: string) {
  const db = await dbPromise
  const moment = await db.get('moments', momentId)
  return moment ? checkMomentSchema(moment) : undefined
}

export async function createMoment(name: string) {
  const db = await dbPromise
  const moment = makeMoment(name)
  await db.put('moments', moment)
  return moment
}

/**
 * The canvas has produced the document for a moment; the draft has done its
 * job. Read and replace in one transaction so a slow save cannot overwrite a
 * rename or a deletion that landed in between.
 */
export async function saveMomentDocument(momentId: string, document: Moment['document'], camera: Moment['camera']) {
  const db = await dbPromise
  const tx = db.transaction('moments', 'readwrite')
  // Observe tx.done even if an individual request rejects first.
  const done = tx.done
  void done.catch(() => {})
  const current = await tx.store.get(momentId)
  if (!current) throw new Error('This moment no longer exists. Your changes have not been saved.')
  if (current.schemaVersion > MOMENT_SCHEMA_VERSION) throw new Error('This moment needs a newer version of my-states.')
  // Every field the record has is named here: a field left out would be
  // dropped by the next canvas save, silently, 300 ms after any drag.
  const next: Moment = {
    id: current.id, name: current.name, createdAt: current.createdAt,
    schemaVersion: MOMENT_SCHEMA_VERSION, document, camera, updatedAt: Date.now(),
    ...withThemeId(current.themeId),
  }
  await tx.store.put(next)
  await done
  return next
}

/** Rename only metadata, in the same transaction as its read. A slow rename
 * must never replace a newer canvas with an older whole-moment object. */
export async function renameMoment(momentId: string, name: string) {
  const db = await dbPromise
  const tx = db.transaction('moments', 'readwrite')
  const done = tx.done
  void done.catch(() => {})
  const current = await tx.store.get(momentId)
  if (!current) throw new Error('This moment no longer exists.')
  const next = { ...current, name: normalizeMomentName(name), updatedAt: Date.now() }
  await tx.store.put(next)
  await done
  return next
}

/**
 * Pins a theme to a moment, or with null returns it to the global theme.
 * Metadata only, in the same transaction as its read, for the same reason
 * as rename. The id is stored whether or not the theme is installed.
 */
export async function setMomentTheme(momentId: string, themeId: string | null) {
  const db = await dbPromise
  const tx = db.transaction('moments', 'readwrite')
  const done = tx.done
  void done.catch(() => {})
  const current = await tx.store.get(momentId)
  if (!current) throw new Error('This moment no longer exists.')
  const { themeId: _previous, ...rest } = current
  const next: Moment = { ...rest, ...withThemeId(themeId), updatedAt: Date.now() }
  await tx.store.put(next)
  await done
  return next
}

export async function setActiveMomentId(momentId: string) {
  const db = await dbPromise
  await db.put('preferences', { key: ACTIVE_MOMENT_KEY, value: momentId })
}

export async function deleteMoment(momentId: string) {
  const db = await dbPromise
  const tx = db.transaction(['moments', 'notes', 'assets', 'directoryHandles', 'preferences'], 'readwrite')
  const noteIds = await tx.objectStore('notes').index('by-moment-updated').getAllKeys(IDBKeyRange.bound([momentId, 0], [momentId, Number.MAX_SAFE_INTEGER]))
  const assetIds = await tx.objectStore('assets').index('by-moment').getAllKeys(momentId)
  const handleIds = await tx.objectStore('directoryHandles').index('by-moment').getAllKeys(momentId)

  await Promise.all([
    ...noteIds.map((id) => tx.objectStore('notes').delete(id)),
    ...assetIds.map((id) => tx.objectStore('assets').delete(id)),
    ...handleIds.map((id) => tx.objectStore('directoryHandles').delete(id)),
    tx.objectStore('moments').delete(momentId),
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

  // Archive content is input, not trusted because it unpacked: every panel
  // is projected onto known keys and validated, and every identity is
  // reissued so an import can never collide with what is already stored.
  const sourcePanels = enforceSingletonPanels(content.panels.map(normalizeDraftPanel))
  const panelIdMap = new Map(sourcePanels.map((panel) => [panel.id, createId('panel')]))
  const noteIdMap = new Map(content.notes.map((note) => [note.id, createId('note')]))
  const panels = sourcePanels.map((panel): Panel => {
    const id = panelIdMap.get(panel.id)!
    if (panel.type !== 'notes') return { ...panel, id }
    // A Notes panel names its note by the note's new id; a reference to a
    // note the archive does not carry is dropped rather than kept dangling.
    const activeNoteId = panel.config.activeNoteId ? noteIdMap.get(panel.config.activeNoteId) ?? null : null
    return { ...panel, id, config: { activeNoteId } }
  })
  const moment = makeMoment(content.name, { panels, canvas: remapLayouts(content.canvas, panelIdMap) }, content.themeId)

  const tx = (await dbPromise).transaction(['moments', 'notes', 'assets'], 'readwrite')
  await tx.objectStore('moments').put(moment)

  for (const note of content.notes) {
    await tx.objectStore('notes').put({
      ...note,
      id: noteIdMap.get(note.id) ?? createId('note'),
      momentId: moment.id,
    })
  }

  for (const asset of content.assets) {
    await tx.objectStore('assets').put({
      ...asset,
      id: createId('image'),
      momentId: moment.id,
      ...(asset.panelId && panelIdMap.has(asset.panelId) ? { panelId: panelIdMap.get(asset.panelId)! } : {}),
    })
  }

  await tx.done
  return moment
}

export async function getMomentSummaries(): Promise<MomentSummary[]> {
  // Listing is metadata-only. One damaged or newer unopened document must
  // not prevent a user from finding the other moments.
  const db = await dbPromise
  return (await db.getAllFromIndex('moments', 'by-updated'))
    .map(({ id, name, updatedAt, themeId }): MomentSummary => ({ id, name, updatedAt, ...withThemeId(themeId) }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function getNotes(momentId: string) {
  const db = await dbPromise
  const notes = await db.getAllFromIndex('notes', 'by-moment-updated', IDBKeyRange.bound([momentId, 0], [momentId, Number.MAX_SAFE_INTEGER]))
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
  const assets = await db.getAllFromIndex('assets', 'by-moment', momentId)
  return panelId ? assets.filter((asset) => !asset.panelId || asset.panelId === panelId) : assets
}

export async function saveMomentAssets(momentId: string, assets: Array<Omit<MomentImage, 'momentId'> & { blob: Blob }>, panelId?: string) {
  validateAssets(assets)
  const db = await dbPromise
  const tx = db.transaction('assets', 'readwrite')
  for (const asset of assets) {
    await tx.store.put({ ...asset, momentId, ...(panelId ? { panelId } : {}) })
  }
  await tx.done
}

export async function replaceMomentAssets(momentId: string, assets: Array<Omit<MomentImage, 'momentId'> & { blob: Blob }>, panelId?: string) {
  validateAssets(assets)
  const db = await dbPromise
  const tx = db.transaction('assets', 'readwrite')
  const existing = await tx.store.index('by-moment').getAll(momentId)
  const existingIds = existing.filter((asset) => !panelId || !asset.panelId || asset.panelId === panelId).map((asset) => asset.id)
  await Promise.all(existingIds.map((id) => tx.store.delete(id)))
  for (const asset of assets) {
    await tx.store.put({ ...asset, momentId, ...(panelId ? { panelId } : {}) })
  }
  await tx.done
}

/*
 * Themes. Built-ins live in the bundle (themes/registry.ts) and are never
 * written here; this store holds only what the user imported. A built-in id
 * is never written, so an import cannot shadow the library.
 */

export async function listStoredThemes(): Promise<StoredTheme[]> {
  const db = await dbPromise
  return (await db.getAll('themes')).sort((left, right) => left.name.localeCompare(right.name))
}

export async function getStoredTheme(id: string) {
  const db = await dbPromise
  return db.get('themes', id)
}

export type ThemeImportOutcome = 'added' | 'renamed' | 'existing'

/**
 * Stores an imported theme under an id that is free. The definition's own
 * id is used when nothing has it; a built-in id, or an id already taken by
 * a stored theme with different content, gets a numeric suffix. An identical
 * theme already stored is returned as it is, so importing the same archive
 * twice does not grow the library.
 */
export async function importStoredTheme(definition: ThemeDefinition, source: StoredTheme['source'] = 'imported'): Promise<{ theme: StoredTheme; outcome: ThemeImportOutcome }> {
  const db = await dbPromise
  const tx = db.transaction('themes', 'readwrite')
  const done = tx.done
  void done.catch(() => {})
  let id = definition.id
  let outcome: ThemeImportOutcome = 'added'
  for (let suffix = 2; ; suffix += 1) {
    const existing = isBuiltInThemeId(id) ? undefined : await tx.store.get(id)
    if (!isBuiltInThemeId(id) && !existing) break
    if (existing && sameDefinition(existing.definition, definition)) {
      await done
      return { theme: existing, outcome: 'existing' }
    }
    id = `${definition.id}-${suffix}`
    outcome = 'renamed'
  }
  const now = Date.now()
  const theme: StoredTheme = {
    id, name: definition.name, version: definition.version, schemaVersion: definition.schemaVersion,
    source, definition: id === definition.id ? definition : { ...definition, id },
    createdAt: now, updatedAt: now,
  }
  await tx.store.put(theme)
  await done
  return { theme, outcome }
}

export async function deleteStoredTheme(id: string) {
  if (isBuiltInThemeId(id)) throw new Error('Built-in themes cannot be deleted.')
  const db = await dbPromise
  const tx = db.transaction(['themes', 'preferences'], 'readwrite')
  await tx.objectStore('themes').delete(id)
  // The global choice must always name an installed theme.
  const global = await tx.objectStore('preferences').get(GLOBAL_THEME_KEY)
  if (global?.value === id) await tx.objectStore('preferences').put({ key: GLOBAL_THEME_KEY, value: DEFAULT_THEME_ID })
  await tx.done
}

/** Same theme apart from the id it was stored under. */
function sameDefinition(left: ThemeDefinition, right: ThemeDefinition) {
  return stableJson({ ...left, id: '' }) === stableJson({ ...right, id: '' })
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const themeModePreferences = new Set<string>(['system', 'light', 'dark'])

/** The appearance settings, with the built-in defaults where nothing is stored. */
export async function getAppearanceSettings(): Promise<AppearanceSettings> {
  const db = await dbPromise
  const [theme, mode] = await Promise.all([db.get('preferences', GLOBAL_THEME_KEY), db.get('preferences', THEME_MODE_KEY)])
  return {
    globalThemeId: theme?.value || DEFAULT_THEME_ID,
    modePreference: mode && themeModePreferences.has(mode.value) ? mode.value as ThemeModePreference : 'system',
  }
}

export async function setGlobalThemeId(themeId: string) {
  const db = await dbPromise
  await db.put('preferences', { key: GLOBAL_THEME_KEY, value: themeId })
}

export async function setThemeModePreference(preference: ThemeModePreference) {
  const db = await dbPromise
  await db.put('preferences', { key: THEME_MODE_KEY, value: preference })
}

export function loadSpotifyTokens() {
  return readJson<SpotifyTokens | null>(SPOTIFY_TOKENS_KEY, null)
}

export function saveSpotifyTokens(tokens: SpotifyTokens | null) {
  if (!tokens) {
    window.localStorage.removeItem(SPOTIFY_TOKENS_KEY)
    return
  }
  window.localStorage.setItem(SPOTIFY_TOKENS_KEY, JSON.stringify(tokens))
}

function validateAssets(assets: Array<Omit<MomentImage, 'momentId'> & { blob: Blob }>) {
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

/**
 * Reading never rewrites a stored moment. A moment written by a newer build
 * is refused as such, so that build's data is left for it to read.
 */
function checkMomentSchema(moment: Moment): Moment {
  if (moment.schemaVersion > MOMENT_SCHEMA_VERSION) throw new Error('This moment needs a newer version of my-states. Its stored data has not been changed.')
  if (moment.schemaVersion !== MOMENT_SCHEMA_VERSION) throw new Error('This moment has an unsupported format. Its stored data has not been changed.')
  return moment
}

/** At most one panel of a singleton kind (the registry says which kinds are singleton); later ones are dropped. */
function enforceSingletonPanels(panels: Panel[]): Panel[] {
  const seen = new Set<PanelType>()
  return panels.filter((panel) => {
    if (!getPanelDefinition(panel.type).singleton) return true
    if (seen.has(panel.type)) return false
    seen.add(panel.type)
    return true
  })
}

const panelDirectoryKey = (momentId: string, panelId: string) => `${momentId}:${panelId}`

export async function savePanelDirectoryHandle(momentId: string, panelId: string, handle: FileSystemDirectoryHandle) {
  const db = await dbPromise
  await db.put('directoryHandles', { id: panelDirectoryKey(momentId, panelId), momentId, panelId, name: handle.name, handle })
}

export async function getPanelDirectoryHandle(momentId: string, panelId: string) {
  const db = await dbPromise
  return db.get('directoryHandles', panelDirectoryKey(momentId, panelId))
}

export async function clearPanelDirectoryHandle(momentId: string, panelId: string) {
  const db = await dbPromise
  await db.delete('directoryHandles', panelDirectoryKey(momentId, panelId))
}

/** Layouts follow their panels' reissued ids; a layout for no panel is dropped. */
function remapLayouts(canvas: CanvasState | null, panelIdMap: Map<string, string>): CanvasState | null {
  if (!canvas) return null
  return {
    camera: canvas.camera,
    panels: canvas.panels.flatMap((layout) => {
      const panelId = panelIdMap.get(layout.panelId)
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
