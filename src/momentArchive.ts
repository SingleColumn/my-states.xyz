import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync } from 'fflate'
import {
  getNotes,
  getMoment,
  getMomentAssets,
  getStoredTheme,
  importMomentContent,
  importStoredTheme,
  momentLimits,
  type ThemeImportOutcome,
} from './storage'
import { draftFromDocument } from './panelStore'
import { normalizeDraftPanel } from './panelInput'
import { isBuiltInThemeId } from './themes/registry'
import type { ThemeDefinition } from './themes/types'
import { acceptEveryValue, THEME_ID_PATTERN, validateThemeDefinition, type SupportsCssValue } from './themes/validate'
import type {
  CanvasState,
  Note,
  Panel,
  MomentImage,
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
 * manifest without the key means the moment follows the global theme, which
 * is what every earlier moment did. It is inline in the manifest rather than
 * a file of its own because earlier builds refuse a file they do not expect.
 */
const FORMAT_VERSION = 2
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

interface MomentManifest {
  formatVersion: typeof FORMAT_VERSION
  moment: {
    name: string
    createdAt: number
    updatedAt: number
  }
  /**
   * The theme the moment pins. Absent: the moment follows the global theme.
   * A built-in theme travels as its id alone, since every build has it; an
   * imported one travels with its definition, so the moment looks the same
   * in another browser. A pinned theme that was not installed at export
   * travels as its id, as the spec asks: it may be installed at the other end.
   */
  theme?: { id: string; definition?: ThemeDefinition }
  /** The moment's draft: panels and their layout, in the app's own terms. */
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
    filename: string
    path: string
    mimeType: string
    size: number
    lastModified: number
    width: number | null
    height: number | null
  }>
}

export async function exportMomentArchive(momentId: string) {
  const [moment, notes, assets] = await Promise.all([getMoment(momentId), getNotes(momentId), getMomentAssets(momentId)])
  if (!moment) throw new Error('The selected moment no longer exists.')
  const theme = moment.themeId ? await themeForArchive(moment.themeId) : undefined
  // The archive carries a moment as a draft, in the app's own terms: the
  // tldraw document is the app's persistence format, not its interchange
  // format, so a change to tldraw's is not a change to the file.
  const { panels: draftPanels, canvas } = draftFromDocument(moment.document, moment.camera)
  const noteIds = new Set(notes.map((note) => note.id))
  // A Notes panel can be left pointing at a note that no longer exists (a
  // second panel showing a note deleted through a different one). Import
  // rejects that reference outright, so a moment carrying it must not be
  // allowed to produce a backup it cannot itself restore.
  const panels = draftPanels.map((panel) => panel.type === 'notes' && panel.config.activeNoteId !== null && !noteIds.has(panel.config.activeNoteId)
    ? { ...panel, config: { activeNoteId: null } }
    : panel)
  // Bundled files already ship with the app; inactive local assets are not duplicated in the archive.
  const exportedAssets = panels.some((panel) => panel.type === 'slideshow' && panel.config.imageSource.type === 'session-assets') ? assets : []
  validateExportContent(notes, exportedAssets)

  const files: Record<string, Uint8Array> = {}
  const manifest: MomentManifest = {
    formatVersion: FORMAT_VERSION,
    moment: {
      name: moment.name,
      createdAt: moment.createdAt,
      updatedAt: moment.updatedAt,
    },
    ...(theme ? { theme } : {}),
    panels,
    canvas,
    notes: [],
    images: [],
  }

  const usedNotePaths = new Set<string>()
  for (const note of notes) {
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

  for (const asset of exportedAssets) {
    const extension = extensionForAsset(asset)
    const path = `images/${asset.id}.${extension}`
    files[path] = new Uint8Array(await asset.blob.arrayBuffer())
    manifest.images.push({
      id: asset.id,
      ...(asset.panelId ? { panelId: asset.panelId } : {}),
      filename: asset.filename,
      path,
      mimeType: asset.mimeType,
      size: asset.size,
      lastModified: asset.lastModified,
      width: asset.width,
      height: asset.height,
    })
  }

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const archive = zipSync(files, { level: 6 })
  if (archive.byteLength > momentLimits.maxArchiveBytes) {
    throw new Error('The compressed moment archive exceeds the 260 MB limit.')
  }

  return new Blob([archive], { type: 'application/zip' })
}

export interface MomentArchiveImport {
  moment: Awaited<ReturnType<typeof importMomentContent>>
  /** Set when the archive carried a theme definition: what happened to it. */
  theme?: { name: string; outcome: ThemeImportOutcome }
}

export async function importMomentArchive(file: File, supportsCssValue: SupportsCssValue = acceptEveryValue): Promise<MomentArchiveImport> {
  if (file.size > momentLimits.maxArchiveBytes) {
    throw new Error('The selected archive exceeds the 260 MB limit.')
  }

  const files = extractArchive(new Uint8Array(await file.arrayBuffer()))
  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) throw new Error('The moment archive is missing manifest.json.')

  const manifest = parseManifest(manifestBytes)
  validateManifest(manifest, files, supportsCssValue)

  // An embedded theme is installed first, under whatever id is free, and
  // the moment pins that id. The library is never overwritten by an import.
  let themeId = manifest.theme?.id
  let theme: MomentArchiveImport['theme']
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
    filename: image.filename,
    mimeType: image.mimeType,
    name: image.filename,
    size: image.size,
    lastModified: image.lastModified,
    width: image.width,
    height: image.height,
    blob: new Blob([toArrayBuffer(files.get(image.path)!)], { type: image.mimeType }),
  }))

  const moment = await importMomentContent({
    name: manifest.moment.name,
    ...(themeId ? { themeId } : {}),
    panels: manifest.panels,
    canvas: manifest.canvas,
    notes,
    assets,
  })
  return { moment, ...(theme ? { theme } : {}) }
}

async function themeForArchive(themeId: string): Promise<MomentManifest['theme']> {
  if (isBuiltInThemeId(themeId)) return { id: themeId }
  const stored = await getStoredTheme(themeId)
  return stored ? { id: themeId, definition: stored.definition } : { id: themeId }
}

export function downloadMomentArchive(blob: Blob, momentName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFileStem(momentName)}.moment.zip`
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function validateExportContent(notes: Note[], assets: Array<MomentImage & { blob: Blob }>) {
  if (notes.length > maxNoteCount) throw new Error(`A moment can contain at most ${maxNoteCount} notes.`)
  if (assets.length > momentLimits.maxImageCount) throw new Error(`A moment can contain at most ${momentLimits.maxImageCount} images.`)

  let noteBytes = 0
  let imageBytes = 0
  for (const note of notes) {
    const bytes = strToU8(note.content).byteLength
    if (bytes > maxNoteBytes) throw new Error(`The note "${note.title}" exceeds the 1 MB limit.`)
    noteBytes += bytes
  }
  if (noteBytes > maxTotalNoteBytes) throw new Error('Notes exceed the 10 MB moment limit.')

  for (const asset of assets) {
    if (!supportedImageTypes.has(asset.mimeType)) throw new Error(`${asset.filename} has an unsupported image type.`)
    if (asset.blob.size !== asset.size) throw new Error(`${asset.filename} no longer matches its stored file size.`)
    if (asset.size > momentLimits.maxImageBytes) throw new Error(`${asset.filename} exceeds the 25 MB per-image limit.`)
    imageBytes += asset.size
  }
  if (imageBytes > momentLimits.maxTotalImageBytes) throw new Error('Images exceed the 250 MB moment limit.')
}

function extractArchive(source: Uint8Array) {
  const files = new Map<string, Uint8Array>()
  let totalBytes = 0
  let fileCount = 0
  let failure: Error | null = null
  const maxTotalBytes = momentLimits.maxTotalImageBytes + maxTotalNoteBytes + 1024 * 1024
  const maxFileCount = momentLimits.maxImageCount + maxNoteCount + 1

  const unzip = new Unzip((entry) => {
    if (failure) return
    try {
      validateArchivePath(entry.name)
      if (files.has(entry.name) || ++fileCount > maxFileCount) {
        throw new Error('The archive contains duplicate or too many files.')
      }
      if (entry.originalSize !== undefined && entry.originalSize > momentLimits.maxTotalImageBytes) {
        throw new Error('The archive contains an oversized file.')
      }

      const chunks: Uint8Array[] = []
      entry.ondata = (error, chunk, final) => {
        if (failure) return
        if (error) {
          failure = new Error('The moment archive could not be read.')
          entry.terminate()
          return
        }
        totalBytes += chunk.byteLength
        if (totalBytes > maxTotalBytes) {
          failure = new Error('The archive expands beyond the permitted moment size.')
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
    throw new Error(caught instanceof Error ? `The moment archive is invalid: ${caught.message}` : 'The moment archive is invalid.')
  }

  if (failure) throw failure
  return files
}

function parseManifest(bytes: Uint8Array): MomentManifest {
  try {
    return JSON.parse(strFromU8(bytes)) as MomentManifest
  } catch {
    throw new Error('manifest.json is not valid JSON.')
  }
}

function validateManifest(manifest: MomentManifest, files: Map<string, Uint8Array>, supportsCssValue: SupportsCssValue) {
  if (!isRecord(manifest)) throw new Error('This moment archive uses an unsupported format version.')
  const formatVersion: unknown = manifest.formatVersion
  if (formatVersion === 1) {
    throw new Error('This file was exported by an earlier version of my-states and cannot be opened by this one.')
  }
  if (formatVersion !== FORMAT_VERSION) {
    throw new Error('This moment archive uses an unsupported format version.')
  }
  if (!isMomentMetadata(manifest.moment) || !isPanels(manifest.panels)) {
    throw new Error('The moment manifest has invalid metadata.')
  }
  if (!isCanvasState(manifest.canvas) || !Array.isArray(manifest.notes) || !Array.isArray(manifest.images)) {
    throw new Error('The moment manifest has invalid workspace data.')
  }
  if (manifest.theme !== undefined) validateManifestTheme(manifest.theme, supportsCssValue)
  if (manifest.notes.length > maxNoteCount || manifest.images.length > momentLimits.maxImageCount) {
    throw new Error('The moment archive exceeds the permitted number of notes or images.')
  }

  const referencedPaths = new Set<string>(['manifest.json'])
  const noteIds = new Set<string>()
  const imageIds = new Set<string>()
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
    if (!isRecord(image) || !isSafeId(image.id) || (image.panelId !== undefined && !isSafeId(image.panelId)) || imageIds.has(image.id) || typeof image.filename !== 'string' || !supportedImageTypes.has(image.mimeType) || !isTimestamp(image.lastModified) || !isNullableDimension(image.width) || !isNullableDimension(image.height)) {
      throw new Error('The manifest contains an invalid image.')
    }
    const expectedPath = `images/${image.id}.${extensionForMimeType(image.mimeType)}`
    if (image.path !== expectedPath || !files.has(image.path) || referencedPaths.has(image.path)) {
      throw new Error('The manifest references a missing or duplicate image file.')
    }
    const bytes = files.get(image.path)!.byteLength
    if (image.size !== bytes || bytes > momentLimits.maxImageBytes) {
      throw new Error('An image does not match its declared size or exceeds the per-image limit.')
    }
    imageBytes += bytes
    imageIds.add(image.id)
    referencedPaths.add(image.path)
  }

  if (noteBytes > maxTotalNoteBytes || imageBytes > momentLimits.maxTotalImageBytes) {
    throw new Error('The archive exceeds the permitted moment size.')
  }
  for (const panel of manifest.panels) {
    if (panel.type === 'notes' && panel.config.activeNoteId !== null && !noteIds.has(panel.config.activeNoteId)) {
      throw new Error('A Notes panel refers to a note that is not included in the archive.')
    }
  }
  if (files.size !== referencedPaths.size) throw new Error('The archive contains unexpected files.')
}

/** The theme reference goes through the same validator a theme file does; its id must match the id it is filed under. */
function validateManifestTheme(theme: unknown, supportsCssValue: SupportsCssValue) {
  if (!isRecord(theme) || typeof theme.id !== 'string' || !THEME_ID_PATTERN.test(theme.id) || theme.id.length > 64) {
    throw new Error('The moment manifest has an invalid theme reference.')
  }
  if (theme.definition === undefined) return
  const definition = validateThemeDefinition(theme.definition, supportsCssValue)
  if (definition.id !== theme.id) throw new Error('The moment manifest has an invalid theme reference.')
}

function validateArchivePath(path: string) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || path.includes('//')) {
    throw new Error('The archive contains an unsafe file path.')
  }
  if (path !== 'manifest.json' && !isValidNoteArchivePath(path) && !/^images\/[A-Za-z0-9_-]+\.(jpg|png|webp|gif|avif|bmp|svg)$/.test(path)) {
    throw new Error('The archive contains an unexpected file path.')
  }
}

function extensionForAsset(asset: MomentImage) {
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
  return sanitized || 'untitled-moment'
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

function isMomentMetadata(value: unknown): value is MomentManifest['moment'] {
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
