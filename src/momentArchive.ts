import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync } from 'fflate'
import {
  getNotes,
  getMoment,
  getMomentAssets,
  importMomentContent,
  momentLimits,
} from './storage'
import type {
  CanvasState,
  Note,
  Panel,
  MomentImage,
  SlideshowSettings,
  SpotifyPlaylistReference,
} from './types'

const FORMAT_VERSION = 1
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
  formatVersion: 1
  /** Named when moments were still sessions; kept so archives exported before the rename still import. */
  session: {
    name: string
    createdAt: number
    updatedAt: number
    activeNoteId: string | null
  }
  canvas: CanvasState | null
  slideshow: SlideshowSettings
  spotify: SpotifyPlaylistReference
  panels?: Panel[]
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
  // Bundled files already ship with the app; inactive local assets are not duplicated in the archive.
  const slideshow = moment.panels.find((panel) => panel.type === 'slideshow')
  const spotify = moment.panels.find((panel) => panel.type === 'spotify')
  const notesPanel = moment.panels.find((panel) => panel.type === 'notes')
  const slideshowSettings = slideshow?.config
  const exportedAssets = moment.panels.some((panel) => panel.type === 'slideshow' && panel.config.imageSource.type === 'session-assets') ? assets : []
  validateExportContent(notes, exportedAssets)

  const files: Record<string, Uint8Array> = {}
  const manifest: MomentManifest = {
    formatVersion: FORMAT_VERSION,
    session: {
      name: moment.name,
      createdAt: moment.createdAt,
      updatedAt: moment.updatedAt,
      activeNoteId: notesPanel?.config.activeNoteId ?? null,
    },
    canvas: moment.canvas,
    slideshow: slideshowSettings!,
    spotify: spotify?.config.playlist ?? { id: null, uri: null, name: null, url: null },
    panels: moment.panels,
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

export async function importMomentArchive(file: File) {
  if (file.size > momentLimits.maxArchiveBytes) {
    throw new Error('The selected archive exceeds the 260 MB limit.')
  }

  const files = extractArchive(new Uint8Array(await file.arrayBuffer()))
  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) throw new Error('The moment archive is missing manifest.json.')

  const manifest = parseManifest(manifestBytes)
  validateManifest(manifest, files)

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

  return importMomentContent({
    name: manifest.session.name,
    canvas: manifest.canvas,
    slideshow: manifest.slideshow,
    spotify: manifest.spotify,
    panels: manifest.panels,
    activeNoteSourceId: manifest.session.activeNoteId,
    notes,
    assets,
  })
}

export function downloadMomentArchive(blob: Blob, momentName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFileStem(momentName)}.mix-session.zip`
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

function validateManifest(manifest: MomentManifest, files: Map<string, Uint8Array>) {
  if (!isRecord(manifest) || manifest.formatVersion !== FORMAT_VERSION) {
    throw new Error('This moment archive uses an unsupported format version.')
  }
  if (!isMomentMetadata(manifest.session) || !isSlideshowSettings(manifest.slideshow) || !isPlaylistReference(manifest.spotify) || (manifest.panels !== undefined && !isPanels(manifest.panels))) {
    throw new Error('The moment manifest has invalid metadata.')
  }
  if (!isCanvasState(manifest.canvas) || !Array.isArray(manifest.notes) || !Array.isArray(manifest.images)) {
    throw new Error('The moment manifest has invalid workspace data.')
  }
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
  if (manifest.session.activeNoteId !== null && !noteIds.has(manifest.session.activeNoteId)) {
    throw new Error('The active note is not included in the archive.')
  }
  if (files.size !== referencedPaths.size) throw new Error('The archive contains unexpected files.')
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

function isMomentMetadata(value: unknown): value is MomentManifest['session'] {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 80 &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    (value.activeNoteId === null || isSafeId(value.activeNoteId))
  )
}

function isPlaylistReference(value: unknown): value is SpotifyPlaylistReference {
  return isRecord(value) && ['id', 'uri', 'name', 'url'].every((key) => value[key] === null || typeof value[key] === 'string')
}

function isSlideshowSettings(value: unknown): value is SlideshowSettings {
  return (
    isRecord(value) &&
    (value.folderName === null || typeof value.folderName === 'string') &&
    (value.imageSource === undefined || isImageSource(value.imageSource)) &&
    typeof value.currentIndex === 'number' &&
    Number.isInteger(value.currentIndex) &&
    value.currentIndex >= 0 &&
    typeof value.intervalMs === 'number' &&
    Number.isFinite(value.intervalMs) &&
    value.intervalMs >= 100 &&
    typeof value.transitionMs === 'number' &&
    Number.isFinite(value.transitionMs) &&
    value.transitionMs >= 0 &&
    typeof value.shuffle === 'boolean' &&
    typeof value.zoom === 'number' &&
    Number.isFinite(value.zoom) &&
    value.zoom > 0
  )
}

function isImageSource(value: unknown) {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'none' || value.type === 'session-assets') return true
  return value.type === 'bundled' && typeof value.collectionId === 'string' && value.collectionId.length > 0
}

function isCanvasState(value: unknown): value is CanvasState | null {
  if (value === null) return true
  if (!isRecord(value) || !isRecord(value.camera) || !Array.isArray(value.panels)) return false
  const camera = value.camera
  if (!['x', 'y', 'z'].every((key) => typeof camera[key] === 'number' && Number.isFinite(camera[key] as number))) return false
  return value.panels.every(
    (panel) =>
      isRecord(panel) &&
      (isSafeId(panel.panelId) || ['spotify', 'slideshow', 'notes'].includes(panel.panelType as string)) &&
      ['x', 'y', 'w', 'h'].every((key) => typeof panel[key] === 'number' && Number.isFinite(panel[key] as number)) &&
      (panel.rotation === undefined || (typeof panel.rotation === 'number' && Number.isFinite(panel.rotation))) &&
      (panel.order === undefined || (typeof panel.order === 'number' && Number.isFinite(panel.order))),
  )
}

function isPanels(value: unknown): value is Panel[] {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  return value.every((panel) => {
    if (!isRecord(panel) || !isSafeId(panel.id) || ids.has(panel.id) || !isTimestamp(panel.createdAt) || !isTimestamp(panel.updatedAt)) return false
    if (panel.visible !== undefined && typeof panel.visible !== 'boolean') return false
    ids.add(panel.id)
    if (panel.type === 'spotify') return isRecord(panel.config) && isPlaylistReference(panel.config.playlist)
    if (panel.type === 'slideshow') return isRecord(panel.config) && isSlideshowSettings(panel.config)
    if (panel.type === 'notes') return isRecord(panel.config) && (panel.config.activeNoteId === null || isSafeId(panel.config.activeNoteId))
    return false
  })
}
