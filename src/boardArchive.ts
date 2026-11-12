import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync } from 'fflate'
import {
  getNotes,
  getBoard,
  getBoardAssets,
  getStoredTheme,
  importBoardContent,
  importStoredTheme,
  boardLimits,
  type ImportedBoardContent,
  type ThemeImportOutcome,
} from './storage'
import { draftFromDocument } from './panelStore'
import { normalizeDraftPanel } from './panelInput'
import { configuredImageCollectionsBaseUrl, loadCuratedCollectionCatalog, type CuratedCollectionItem } from './curatedImageCollections'
import { isBuiltInThemeId } from './themes/registry'
import type { ThemeDefinition } from './themes/types'
import { acceptEveryValue, THEME_ID_PATTERN, validateThemeDefinition, type SupportsCssValue } from './themes/validate'
import type {
  CanvasState,
  Board,
  Note,
  Panel,
  BoardImage,
  ImageAttribution,
} from './types'

/**
 * Version 2 is the first format written for the `my-states` database, on
 * 2026-09-13. Version 1 files, written by earlier builds, are refused with a
 * message that says so; that generation of saved work was discarded along
 * with the browser data it came from. From version 2 on,
 * a file this app exports is meant to stay openable by later versions.
 *
 * The optional `theme` field was added on 2026-09-15 without a version
 * change: a build without themes ignores an unknown manifest key, and a
 * manifest without the key means the board follows the global theme, which
 * is what every earlier board did. Version 3 adds shared image-to-panel
 * references so a repeated curated image travels only once; version 2 stays
 * readable. Themes are inline because older builds reject unexpected files.
 */
const FORMAT_VERSION = 3
const OLDEST_SUPPORTED_FORMAT_VERSION = 2
const maxNoteCount = 500
const maxNoteBytes = 1024 * 1024
const maxTotalNoteBytes = 10 * 1024 * 1024
const supportedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
])

interface BoardManifest {
  formatVersion: number
  board: {
    name: string
    createdAt: number
    updatedAt: number
  }
  /**
   * The theme the board pins. Absent: the board follows the global theme.
   * A built-in theme travels as its id alone, since every build has it; an
   * imported one travels with its definition, so the board looks the same
   * in another browser. A pinned theme that was not installed at export
   * travels as its id, as the spec asks: it may be installed at the other end.
   */
  theme?: { id: string; definition?: ThemeDefinition }
  /** The board's draft: panels and their layout, in the app's own terms. */
  panels: Panel[]
  canvas: CanvasState | null
  notes: Array<{
    id: string
    title: string
    path: string
    createdAt: number
    updatedAt: number
  }>
  images: Array<{
    id: string
    panelId?: string
    panelIds?: string[]
    filename: string
    path: string
    mimeType: string
    size: number
    lastModified: number
    width: number | null
    height: number | null
    attribution?: ImageAttribution
  }>
}

/**
 * A board read out in the app's own interchange terms -- the same shape
 * `importBoardContent` takes -- plus the stored record it came from. The
 * one place a board is turned from "a record in the database" into "data
 * that could become a different board"; `exportBoardArchive` packages it
 * into a zip, `duplicateBoard` hands it straight back to storage.
 */
async function buildBoardContent(
  boardId: string,
  snapshotCurated = false,
  fetcher: typeof fetch = fetch,
  curatedBaseUrl: string | null = configuredImageCollectionsBaseUrl,
  curatedExport: CuratedExportChoice = { scope: 'visible' },
): Promise<{ board: Board; content: ImportedBoardContent }> {
  const [board, notes, assets] = await Promise.all([getBoard(boardId), getNotes(boardId), getBoardAssets(boardId)])
  if (!board) throw new Error('The selected board no longer exists.')
  // The archive carries a board as a draft, in the app's own terms: the
  // tldraw document is the app's persistence format, not its interchange
  // format, so a change to tldraw's is not a change to the file.
  const { panels: draftPanels, canvas } = draftFromDocument(board.document, board.camera)
  const noteIds = new Set(notes.map((note) => note.id))
  // A Notes panel can be left pointing at a note that no longer exists (a
  // second panel showing a note deleted through a different one). Import
  // rejects that reference outright, so a board carrying it must not be
  // allowed to produce a copy it cannot itself restore.
  let panels = draftPanels.map((panel) => panel.type === 'notes' && panel.config.activeNoteId !== null && !noteIds.has(panel.config.activeNoteId)
    ? { ...panel, config: { activeNoteId: null } }
    : panel)
  // Bundled files already ship with the app; inactive local assets are not duplicated.
  let exportedAssets: ImportedBoardContent['assets'] = panels.some((panel) => panel.type === 'slideshow' && panel.config.imageSource.type === 'session-assets') ? assets : []
  // Only an export trims; duplicating a board keeps every stored picture.
  if (snapshotCurated && curatedExport.scope === 'visible') {
    const trimmed = keepOnlyShownCollectionImages(panels, exportedAssets, curatedExport)
    panels = trimmed.panels
    exportedAssets = trimmed.assets
  }
  if (snapshotCurated &&panels.some((panel) => panel.type === 'slideshow' && panel.config.imageSource.type === 'curated')) {
    const snapshot = await snapshotCuratedCollections(panels, fetcher, curatedBaseUrl, curatedExport)
    panels = snapshot.panels
    exportedAssets = [...exportedAssets, ...snapshot.assets]
  }
  validateExportContent(notes, exportedAssets)

  const content: ImportedBoardContent = {
    name: board.name,
    ...(board.themeId ? { themeId: board.themeId } : {}),
    panels,
    canvas,
    notes: notes.map(({ id, title, content: body, createdAt, updatedAt }) => ({ id, title, content: body, createdAt, updatedAt })),
    assets: exportedAssets,
  }
  return { board, content }
}

/**
 * A board imported from an export with complete collections holds its pictures
 * itself, so its panels no longer point at an online collection. A panel whose
 * pictures all carry a creator credit is still a collection, and is treated like
 * one: its export takes only the picture on screen. Pictures from the viewer's
 * own folder have no credit and always travel whole, since nothing else holds
 * them. This rests on credit being what tells the two apart; if the app ever
 * credits a viewer's own pictures, those would be trimmed too.
 */
function keepOnlyShownCollectionImages(
  panels: Panel[],
  assets: ImportedBoardContent['assets'],
  choice: CuratedExportChoice,
): { panels: Panel[]; assets: ImportedBoardContent['assets'] } {
  // Same rule storage uses to say which panels a stored picture belongs to.
  const belongsTo = (asset: ImportedBoardContent['assets'][number], panelId: string) =>
    asset.panelIds?.includes(panelId) || (!asset.panelIds?.length && (!asset.panelId || asset.panelId === panelId))
  const keptBy = new Map<string, Set<string>>() // picture id -> trimmed panels that still show it
  const trimmedPanels = new Set<string>()
  const nextPanels = panels.map((panel): Panel => {
    if (panel.type !== 'slideshow' || panel.config.imageSource.type !== 'session-assets') return panel
    const own = assets.filter((asset) => belongsTo(asset, panel.id))
    if (!own.length || !own.every((asset) => asset.attribution?.creator)) return panel
    // The slideshow lists its pictures by name, so the saved position counts in that order.
    const byName = [...own].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    const shown = own.find((asset) => asset.id === choice.visibleItemIds?.[panel.id]) ?? byName[panel.config.currentIndex] ?? byName[0]
    trimmedPanels.add(panel.id)
    keptBy.set(shown.id, (keptBy.get(shown.id) ?? new Set()).add(panel.id))
    return { ...panel, config: { ...panel.config, currentIndex: 0 } }
  })
  if (!trimmedPanels.size) return { panels, assets }

  const nextAssets = assets.flatMap((asset) => {
    const owners = nextPanels.filter((panel) => panel.type === 'slideshow' && belongsTo(asset, panel.id)).map((panel) => panel.id)
    const trimmedOwners = owners.filter((panelId) => trimmedPanels.has(panelId))
    // Not part of any trimmed panel (a viewer's own pictures): travels as it was.
    if (!trimmedOwners.length) return [asset]
    const stillShownBy = keptBy.get(asset.id)
    // A shared picture still belongs to every untrimmed panel that used it.
    const panelIds = [...owners.filter((panelId) => !trimmedPanels.has(panelId)), ...(stillShownBy ?? [])]
    if (!panelIds.length) return []
    const { panelId: _single, ...rest } = asset
    return [{ ...rest, panelIds }]
  })
  return { panels: nextPanels, assets: nextAssets }
}

/**
 * What an exported Images panel takes along from an online collection.
 * `visible` is the one picture the panel is showing; `all` is the whole
 * collection, so the slideshow keeps playing after the board is imported.
 */
export interface CuratedExportChoice {
  scope: 'visible' | 'all'
  /**
   * The online-collection image each panel is showing right now, by panel id.
   * The live position is not always saved to the panel while a show is
   * playing, so the screen supplies it; a panel missing here falls back to
   * its saved position.
   */
  visibleItemIds?: Record<string, string>
}

async function snapshotCuratedCollections(panels: Panel[], fetcher: typeof fetch, curatedBaseUrl: string | null, choice: CuratedExportChoice) {
  if (!curatedBaseUrl) {
    throw new Error('This board uses online image collections, but their source is not configured. The export was not created.')
  }
  const catalog = await loadCuratedCollectionCatalog(curatedBaseUrl, fetcher)
  const collections = new Map(catalog.collections.map((collection) => [collection.id, collection]))
  const portable = new Map<string, {
    item: CuratedCollectionItem
    panelIds: string[]
  }>()

  const snapshotPanels = panels.map((panel): Panel => {
    if (panel.type !== 'slideshow' || panel.config.imageSource.type !== 'curated') return panel
    const collection = collections.get(panel.config.imageSource.collectionSlug)
    if (!collection) {
      throw new Error(`The image collection "${panel.config.folderName ?? panel.config.imageSource.collectionSlug}" is no longer available, so this board cannot be exported yet.`)
    }
    for (const item of itemsToExport(panel, collection.items, choice)) {
      const existing = portable.get(item.id)
      if (existing) {
        if (!existing.panelIds.includes(panel.id)) existing.panelIds.push(panel.id)
      } else {
        portable.set(item.id, { item, panelIds: [panel.id] })
      }
    }
    return {
      ...panel,
      config: {
        ...panel.config,
        folderName: collection.title,
        imageSource: { type: 'session-assets' },
        // A single exported picture is position 0; the saved position pointed into the full collection.
        ...(choice.scope === 'visible' ? { currentIndex: 0 } : {}),
      },
    }
  })

  const assets = await mapWithConcurrency([...portable.values()], CURATED_DOWNLOAD_CONCURRENCY, async ({ item, panelIds }) => {
    const response = await fetchCuratedImage(item, fetcher)
    const bytes = await response.arrayBuffer()
    const blob = new Blob([bytes], { type: item.mimeType })
    return {
      id: `curated_${item.id}`,
      panelIds,
      filename: item.filename,
      name: item.filename,
      mimeType: item.mimeType,
      size: blob.size,
      lastModified: 0,
      width: item.width,
      height: item.height,
      attribution: item.attribution,
      blob,
    }
  })

  return { panels: snapshotPanels, assets }
}

function itemsToExport(panel: Panel<'slideshow'>, items: CuratedCollectionItem[], choice: CuratedExportChoice): CuratedCollectionItem[] {
  if (choice.scope === 'all') return items
  const shownId = choice.visibleItemIds?.[panel.id]
  // The saved position can be stale, or point past the end if the collection shrank; the first picture is the last resort.
  const shown = items.find((item) => item.id === shownId) ?? items[panel.config.currentIndex] ?? items[0]
  return shown ? [shown] : []
}

// A handful at a time: a collection can hold dozens of full-size photos, and starting
// them all at once makes slow connections time out for no benefit.
const CURATED_DOWNLOAD_CONCURRENCY = 4

async function mapWithConcurrency<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  // Each worker keeps taking the next unstarted item; the first failure rejects the whole
  // export, and the other workers stop picking up new items because `next` is exhausted.
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index])
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  } catch (error) {
    next = items.length
    throw error
  }
  return results
}

// Why a plain download can fail even though the image site is set up correctly: the slideshow
// shows images through an <img> tag, which sends no Origin header, so the browser keeps a copy
// of the file without the cross-site permission header, for up to a year. A later download from
// the app then reuses that stored copy and the browser blocks it. Asking the network again
// (`cache: 'reload'`) gets a fresh copy that carries the header, and refreshes the stored one.
async function fetchCuratedImage(item: CuratedCollectionItem, fetcher: typeof fetch): Promise<Response> {
  const creator = item.attribution.creator
  let response: Response
  try {
    try {
      response = await fetcher(item.fileUrl)
    } catch {
      response = await fetcher(item.fileUrl, { cache: 'reload' })
    }
  } catch {
    throw new Error(`An image from "${creator}" could not be downloaded for the export. Check your internet connection and try again. If it keeps happening, an ad blocker or browser extension may be blocking the image site.`)
  }
  if (!response.ok) {
    throw new Error(`An image from "${creator}" could not be downloaded for the export (the image site answered with error ${response.status}). Try again later.`)
  }
  return response
}

export async function exportBoardArchive(
  boardId: string,
  options: { fetcher?: typeof fetch; curatedBaseUrl?: string | null; curated?: CuratedExportChoice } = {},
) {
  const { board, content } = await buildBoardContent(
    boardId,
    true,
    options.fetcher ?? fetch,
    options.curatedBaseUrl === undefined ? configuredImageCollectionsBaseUrl : options.curatedBaseUrl,
    options.curated,
  )
  const theme = board.themeId ? await themeForArchive(board.themeId) : undefined

  const files: Record<string, Uint8Array> = {}
  const manifest: BoardManifest = {
    formatVersion: FORMAT_VERSION,
    board: {
      name: board.name,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    },
    ...(theme ? { theme } : {}),
    panels: content.panels,
    canvas: content.canvas,
    notes: [],
    images: [],
  }

  const usedNotePaths = new Set<string>()
  for (const note of content.notes) {
    const path = createNoteArchivePath(note.title, usedNotePaths)
    files[path] = strToU8(note.content)
    manifest.notes.push({
      id: note.id,
      title: note.title,
      path,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })
  }

  for (const asset of content.assets) {
    const extension = extensionForAsset(asset)
    const path = `images/${asset.id}.${extension}`
    files[path] = new Uint8Array(await asset.blob.arrayBuffer())
    manifest.images.push({
      id: asset.id,
      ...(asset.panelId ? { panelId: asset.panelId } : {}),
      ...(asset.panelIds?.length ? { panelIds: asset.panelIds } : {}),
      filename: asset.filename,
      path,
      mimeType: asset.mimeType,
      size: asset.size,
      lastModified: asset.lastModified,
      width: asset.width,
      height: asset.height,
      ...(asset.attribution ? { attribution: asset.attribution } : {}),
    })
  }

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const archive = zipSync(files, { level: 6 })
  if (archive.byteLength > boardLimits.maxArchiveBytes) {
    throw new Error('The compressed board archive exceeds the 260 MB limit.')
  }

  return new Blob([archive], { type: 'application/zip' })
}

/**
 * A copy of a board made without ever leaving the browser: no zip is
 * produced or parsed, so none of the archive format's edge cases (a zip
 * tool's directory-marker entries among them) can apply to it. The copy
 * gets its own identity throughout -- `importBoardContent` reissues every
 * id, the same as a file import -- and the name the caller gives it, which
 * is expected to already be free of collisions (see `nextDuplicateName`).
 */
export async function duplicateBoard(boardId: string, name: string) {
  const { content } = await buildBoardContent(boardId)
  return importBoardContent({ ...content, name })
}

/**
 * The name a board archive would import under, read without importing it:
 * used to warn before an import would create a same-named duplicate in the
 * picker. Best effort -- any problem with the file is left for the real
 * import to diagnose properly, so this resolves to null rather than
 * throwing.
 */
export async function peekBoardArchiveName(file: File): Promise<string | null> {
  try {
    if (file.size > boardLimits.maxArchiveBytes) return null
    const files = extractArchive(new Uint8Array(await file.arrayBuffer()))
    const manifestBytes = files.get('manifest.json')
    if (!manifestBytes) return null
    const manifest = parseManifest(manifestBytes)
    return isBoardMetadata(manifest.board) ? manifest.board.name : null
  } catch {
    return null
  }
}

export interface BoardArchiveImport {
  board: Awaited<ReturnType<typeof importBoardContent>>
  /** Set when the archive carried a theme definition: what happened to it. */
  theme?: { name: string; outcome: ThemeImportOutcome }
}

export async function importBoardArchive(file: File, supportsCssValue: SupportsCssValue = acceptEveryValue): Promise<BoardArchiveImport> {
  if (file.size > boardLimits.maxArchiveBytes) {
    throw new Error('The selected archive exceeds the 260 MB limit.')
  }

  const files = extractArchive(new Uint8Array(await file.arrayBuffer()))
  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) throw new Error('The board archive is missing manifest.json.')

  const manifest = parseManifest(manifestBytes)
  validateManifest(manifest, files, supportsCssValue)

  // An embedded theme is installed first, under whatever id is free, and
  // the board pins that id. The library is never overwritten by an import.
  let themeId = manifest.theme?.id
  let theme: BoardArchiveImport['theme']
  if (manifest.theme?.definition) {
    const installed = await importStoredTheme(manifest.theme.definition)
    themeId = installed.theme.id
    theme = { name: installed.theme.name, outcome: installed.outcome }
  }

  const notes = manifest.notes.map((note) => ({
    id: note.id,
    title: note.title,
    content: strFromU8(files.get(note.path)!),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }))
  const assets = manifest.images.map((image) => ({
    id: image.id,
    ...(image.panelId ? { panelId: image.panelId } : {}),
    ...(image.panelIds?.length ? { panelIds: image.panelIds } : {}),
    filename: image.filename,
    mimeType: image.mimeType,
    name: image.filename,
    size: image.size,
    lastModified: image.lastModified,
    width: image.width,
    height: image.height,
    ...(image.attribution ? { attribution: image.attribution } : {}),
    blob: new Blob([toArrayBuffer(files.get(image.path)!)], { type: image.mimeType }),
  }))

  const board = await importBoardContent({
    name: manifest.board.name,
    ...(themeId ? { themeId } : {}),
    panels: manifest.panels,
    canvas: manifest.canvas,
    notes,
    assets,
  })
  return { board, ...(theme ? { theme } : {}) }
}

async function themeForArchive(themeId: string): Promise<BoardManifest['theme']> {
  if (isBuiltInThemeId(themeId)) return { id: themeId }
  const stored = await getStoredTheme(themeId)
  return stored ? { id: themeId, definition: stored.definition } : { id: themeId }
}

export function downloadBoardArchive(blob: Blob, boardName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFileStem(boardName)}.board.zip`
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function validateExportContent(notes: Note[], assets: Array<Omit<BoardImage, 'boardId'> & { blob: Blob }>) {
  if (notes.length > maxNoteCount) throw new Error(`A board can contain at most ${maxNoteCount} notes.`)
  if (assets.length > boardLimits.maxImageCount) throw new Error(`A board can contain at most ${boardLimits.maxImageCount} images.`)

  let noteBytes = 0
  let imageBytes = 0
  for (const note of notes) {
    const bytes = strToU8(note.content).byteLength
    if (bytes > maxNoteBytes) throw new Error(`The note "${note.title}" exceeds the 1 MB limit.`)
    noteBytes += bytes
  }
  if (noteBytes > maxTotalNoteBytes) throw new Error('Notes exceed the 10 MB board limit.')

  for (const asset of assets) {
    if (!supportedImageTypes.has(asset.mimeType)) throw new Error(`${asset.filename} has an unsupported image type.`)
    if (asset.blob.size !== asset.size) throw new Error(`${asset.filename} no longer matches its stored file size.`)
    if (asset.size > boardLimits.maxImageBytes) throw new Error(`${asset.filename} exceeds the 25 MB per-image limit.`)
    imageBytes += asset.size
  }
  if (imageBytes > boardLimits.maxTotalImageBytes) throw new Error('Images exceed the 250 MB board limit.')
}

function extractArchive(source: Uint8Array) {
  const files = new Map<string, Uint8Array>()
  let totalBytes = 0
  let fileCount = 0
  let failure: Error | null = null
  const maxTotalBytes = boardLimits.maxTotalImageBytes + maxTotalNoteBytes + 1024 * 1024
  const maxFileCount = boardLimits.maxImageCount + maxNoteCount + 1

  const unzip = new Unzip((entry) => {
    if (failure) return
    // A directory marker: many ordinary zip tools (Explorer's "Compress to
    // ZIP file" among them) write one whenever the thing being zipped
    // contains a subfolder. It carries no content and is none of the three
    // shapes a board archive uses, so an empty one is ignored rather than
    // rejected; one that unexpectedly carries bytes is treated as the
    // unexpected entry it would otherwise be.
    if (entry.name.endsWith('/')) {
      if (entry.originalSize) failure = new Error(`The archive contains an unexpected file path: "${entry.name}"`)
      return
    }
    try {
      validateArchivePath(entry.name)
      if (files.has(entry.name) || ++fileCount > maxFileCount) {
        throw new Error('The archive contains duplicate or too many files.')
      }
      if (entry.originalSize !== undefined && entry.originalSize > boardLimits.maxTotalImageBytes) {
        throw new Error('The archive contains an oversized file.')
      }

      const chunks: Uint8Array[] = []
      entry.ondata = (error, chunk, final) => {
        if (failure) return
        if (error) {
          failure = new Error('The board archive could not be read.')
          entry.terminate()
          return
        }
        totalBytes += chunk.byteLength
        if (totalBytes > maxTotalBytes) {
          failure = new Error('The archive expands beyond the permitted board size.')
          entry.terminate()
          return
        }
        chunks.push(chunk)
        if (final) files.set(entry.name, joinChunks(chunks))
      }
      entry.start()
    } catch (caught) {
      failure = caught instanceof Error ? caught : new Error('The archive contains an invalid entry.')
      entry.terminate()
    }
  })
  unzip.register(UnzipInflate)

  try {
    unzip.push(source, true)
  } catch (caught) {
    throw new Error(caught instanceof Error ? `The board archive is invalid: ${caught.message}` : 'The board archive is invalid.')
  }

  if (failure) throw failure
  return files
}

function parseManifest(bytes: Uint8Array): BoardManifest {
  try {
    return JSON.parse(strFromU8(bytes)) as BoardManifest
  } catch {
    throw new Error('manifest.json is not valid JSON.')
  }
}

function validateManifest(manifest: BoardManifest, files: Map<string, Uint8Array>, supportsCssValue: SupportsCssValue) {
  if (!isRecord(manifest)) throw new Error('This board archive uses an unsupported format version.')
  const formatVersion: unknown = manifest.formatVersion
  if (formatVersion === 1) {
    throw new Error('This file was exported by an earlier version of my-states and cannot be opened by this one.')
  }
  if (formatVersion !== FORMAT_VERSION && formatVersion !== OLDEST_SUPPORTED_FORMAT_VERSION) {
    throw new Error('This board archive uses an unsupported format version.')
  }
  if (!isBoardMetadata(manifest.board) || !isPanels(manifest.panels)) {
    throw new Error('The board manifest has invalid metadata.')
  }
  if (!isCanvasState(manifest.canvas) || !Array.isArray(manifest.notes) || !Array.isArray(manifest.images)) {
    throw new Error('The board manifest has invalid workspace data.')
  }
  if (manifest.theme !== undefined) validateManifestTheme(manifest.theme, supportsCssValue)
  if (manifest.notes.length > maxNoteCount || manifest.images.length > boardLimits.maxImageCount) {
    throw new Error('The board archive exceeds the permitted number of notes or images.')
  }

  const referencedPaths = new Set<string>(['manifest.json'])
  const noteIds = new Set<string>()
  const imageIds = new Set<string>()
  const panelIds = new Set(manifest.panels.map((panel) => panel.id))
  let noteBytes = 0
  let imageBytes = 0

  for (const note of manifest.notes) {
    if (!isRecord(note) || !isSafeId(note.id) || noteIds.has(note.id) || typeof note.title !== 'string' || !isTimestamp(note.createdAt) || !isTimestamp(note.updatedAt)) {
      throw new Error('The manifest contains an invalid note.')
    }
    if (typeof note.path !== 'string' || !isValidNoteArchivePath(note.path) || !files.has(note.path) || referencedPaths.has(note.path)) {
      throw new Error('The manifest references a missing or duplicate note file.')
    }
    const bytes = files.get(note.path)!.byteLength
    if (bytes > maxNoteBytes) throw new Error(`A note exceeds the ${maxNoteBytes / 1024 / 1024} MB limit.`)
    noteBytes += bytes
    noteIds.add(note.id)
    referencedPaths.add(note.path)
  }

  for (const image of manifest.images) {
    if (
      !isRecord(image)
      || !isSafeId(image.id)
      || (image.panelId !== undefined && (!isSafeId(image.panelId) || !panelIds.has(image.panelId)))
      || (image.panelIds !== undefined && (!Array.isArray(image.panelIds) || !image.panelIds.length || new Set(image.panelIds).size !== image.panelIds.length || image.panelIds.some((panelId) => !isSafeId(panelId) || !panelIds.has(panelId))))
      || (image.panelId !== undefined && image.panelIds !== undefined)
      || (image.attribution !== undefined && !isImageAttribution(image.attribution))
      || imageIds.has(image.id)
      || typeof image.filename !== 'string'
      || !supportedImageTypes.has(image.mimeType)
      || !isTimestamp(image.lastModified)
      || !isNullableDimension(image.width)
      || !isNullableDimension(image.height)
    ) {
      throw new Error('The manifest contains an invalid image.')
    }
    const expectedPath = `images/${image.id}.${extensionForMimeType(image.mimeType)}`
    if (image.path !== expectedPath || !files.has(image.path) || referencedPaths.has(image.path)) {
      throw new Error('The manifest references a missing or duplicate image file.')
    }
    const bytes = files.get(image.path)!.byteLength
    if (image.size !== bytes || bytes > boardLimits.maxImageBytes) {
      throw new Error('An image does not match its declared size or exceeds the per-image limit.')
    }
    imageBytes += bytes
    imageIds.add(image.id)
    referencedPaths.add(image.path)
  }

  if (noteBytes > maxTotalNoteBytes || imageBytes > boardLimits.maxTotalImageBytes) {
    throw new Error('The archive exceeds the permitted board size.')
  }
  for (const panel of manifest.panels) {
    if (panel.type === 'notes' && panel.config.activeNoteId !== null && !noteIds.has(panel.config.activeNoteId)) {
      throw new Error('A Notes panel refers to a note that is not included in the archive.')
    }
  }
  if (files.size !== referencedPaths.size) {
    const unexpected = [...files.keys()].filter((path) => !referencedPaths.has(path))
    throw new Error(`The archive contains ${unexpected.length === 1 ? 'a file' : 'files'} its manifest does not reference: ${unexpected.map((path) => `"${path}"`).join(', ')}.`)
  }
}

/** The theme reference goes through the same validator a theme file does; its id must match the id it is filed under. */
function validateManifestTheme(theme: unknown, supportsCssValue: SupportsCssValue) {
  if (!isRecord(theme) || typeof theme.id !== 'string' || !THEME_ID_PATTERN.test(theme.id) || theme.id.length > 64) {
    throw new Error('The board manifest has an invalid theme reference.')
  }
  if (theme.definition === undefined) return
  const definition = validateThemeDefinition(theme.definition, supportsCssValue)
  if (definition.id !== theme.id) throw new Error('The board manifest has an invalid theme reference.')
}

function validateArchivePath(path: string) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('//')) {
    throw new Error(`The archive contains an unsafe file path: "${path}"`)
  }
  if (path !== 'manifest.json' && !isValidNoteArchivePath(path) && !/^images\/[A-Za-z0-9_-]+\.(jpg|png|webp|gif|avif|bmp|svg)$/.test(path)) {
    throw new Error(`The archive contains an unexpected file path: "${path}"`)
  }
}

function extensionForAsset(asset: Pick<BoardImage, 'mimeType'>) {
  return extensionForMimeType(asset.mimeType)
}

function extensionForMimeType(mimeType: string) {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  }
  return extensions[mimeType] ?? 'bin'
}

function safeFileStem(name: string) {
  const sanitized = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  return sanitized || 'untitled-board'
}

function createNoteArchivePath(title: string, usedPaths: Set<string>) {
  const stem = safeNoteFileStem(title)
  let suffix = 1
  let path = `notes/${stem}.md`

  while (usedPaths.has(path.toLowerCase())) {
    suffix += 1
    const duplicateSuffix = ` (${suffix})`
    path = `notes/${stem.slice(0, 120 - duplicateSuffix.length)}${duplicateSuffix}.md`
  }

  usedPaths.add(path.toLowerCase())
  return path
}

function safeNoteFileStem(title: string) {
  const sanitized = title
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 120)

  return sanitized || 'untitled-note'
}

function isValidNoteArchivePath(path: string) {
  if (!path.startsWith('notes/') || !path.endsWith('.md')) return false
  const filename = path.slice('notes/'.length, -'.md'.length)
  return filename.length > 0 && filename.length <= 120 && !/[<>:"/\\|?*\u0000-\u001f]/.test(filename) && !filename.endsWith('.')
}

function joinChunks(chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value)
}

function isNullableDimension(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0)
}

function isImageAttribution(value: unknown): value is ImageAttribution {
  return isRecord(value)
    && typeof value.creator === 'string'
    && value.creator.trim().length > 0
    && (value.creatorUrl === undefined || isSafeHttpsUrl(value.creatorUrl))
    && (value.sourceUrl === undefined || isSafeHttpsUrl(value.sourceUrl))
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isBoardMetadata(value: unknown): value is BoardManifest['board'] {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 80 &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt)
  )
}

function isCanvasState(value: unknown): value is CanvasState | null {
  if (value === null) return true
  if (!isRecord(value) || !isRecord(value.camera) || !Array.isArray(value.panels)) return false
  const camera = value.camera
  if (!['x', 'y', 'z'].every((key) => typeof camera[key] === 'number' && Number.isFinite(camera[key] as number))) return false
  return value.panels.every(
    (panel) =>
      isRecord(panel) &&
      isSafeId(panel.panelId) &&
      ['x', 'y', 'w', 'h'].every((key) => typeof panel[key] === 'number' && Number.isFinite(panel[key] as number)) &&
      (panel.rotation === undefined || (typeof panel.rotation === 'number' && Number.isFinite(panel.rotation))) &&
      (panel.order === undefined || (typeof panel.order === 'number' && Number.isFinite(panel.order))),
  )
}

/**
 * Whether every entry is a well-formed panel, by trying the one place that
 * already knows what "well-formed" means for each registered type
 * (`normalizeDraftPanel`, which reads the registry) rather than a second,
 * hand-written check kept in step with it by hand.
 */
function isPanels(value: unknown): value is Panel[] {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  return value.every((panel) => {
    if (!isRecord(panel) || !isSafeId(panel.id) || ids.has(panel.id)) return false
    try {
      normalizeDraftPanel(panel)
    } catch {
      return false
    }
    ids.add(panel.id)
    return true
  })
}
