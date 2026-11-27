import { strFromU8, Unzip, UnzipInflate } from 'fflate'

export const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024
export const MAX_UNPACKED_BYTES = 50 * 1024 * 1024
const MAX_NOTE_BYTES = 1024 * 1024
const MAX_TOTAL_NOTE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_COUNT = 200
const MAX_NOTE_COUNT = 500
const MAX_MANIFEST_BYTES = 1024 * 1024
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value)
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const mimeExtensions: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
}
const imagePath = /^images\/[A-Za-z0-9_-]+\.(jpg|png|webp|gif|avif|bmp|svg)$/
const notePath = (path: string) => {
  if (!path.startsWith('notes/') || !path.endsWith('.md')) return false
  const name = path.slice(6, -3)
  return name.length > 0 && name.length <= 120 && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !name.endsWith('.')
}
const dimension = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0)
const httpsUrl = (value: unknown) => {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password }
  catch { return false }
}
const attribution = (value: unknown) => record(value) && typeof value.creator === 'string' && !!value.creator.trim()
  && (value.creatorUrl === undefined || httpsUrl(value.creatorUrl))
  && (value.sourceUrl === undefined || httpsUrl(value.sourceUrl))
const validCanvas = (value: unknown) => value === null || (record(value) && record(value.camera) && Array.isArray(value.panels)
  && ['x', 'y', 'z'].every((key) => typeof (value.camera as Record<string, unknown>)[key] === 'number'
    && Number.isFinite((value.camera as Record<string, unknown>)[key]))
  && value.panels.every((panel: unknown) => record(panel) && safeId(panel.panelId)
    && ['x', 'y', 'w', 'h'].every((key) => typeof panel[key] === 'number' && Number.isFinite(panel[key]))
    && (panel.rotation === undefined || (typeof panel.rotation === 'number' && Number.isFinite(panel.rotation)))
    && (panel.order === undefined || (typeof panel.order === 'number' && Number.isFinite(panel.order)))))

/** A bounded server preflight. The recipient still runs the app's full panel/theme validator. */
export function validateTrialArchive(source: Uint8Array): void {
  if (!source.byteLength || source.byteLength > MAX_COMPRESSED_BYTES) throw new Error('The board archive exceeds the 32 MiB trial limit.')
  const files = new Map<string, Uint8Array>()
  let total = 0
  let count = 0
  let failure: Error | null = null
  const unzip = new Unzip((entry) => {
    if (failure) return
    if (entry.name.endsWith('/')) {
      if (entry.originalSize) failure = new Error('The archive has an invalid directory entry.')
      return
    }
    const path = entry.name
    if (
      !path || path.startsWith('/') || path.includes('\\') || path.includes('//')
      || path.split('/').includes('..')
      || (path !== 'manifest.json' && !notePath(path) && !imagePath.test(path))
      || files.has(path) || ++count > MAX_IMAGE_COUNT + MAX_NOTE_COUNT + 1
    ) { failure = new Error('The archive has an unsafe, duplicate, or unexpected entry.'); return }
    const perFile = path === 'manifest.json' ? MAX_MANIFEST_BYTES : path.startsWith('notes/') ? MAX_NOTE_BYTES : MAX_IMAGE_BYTES
    if (entry.originalSize !== undefined && entry.originalSize > perFile) { failure = new Error('An archive entry exceeds its size limit.'); return }
    const chunks: Uint8Array[] = []
    let size = 0
    entry.ondata = (error, chunk, final) => {
      if (failure) return
      if (error) { failure = new Error('The archive could not be decompressed.'); entry.terminate(); return }
      size += chunk.byteLength
      total += chunk.byteLength
      if (size > perFile || total > MAX_UNPACKED_BYTES) {
        failure = new Error('The archive expands beyond the trial limit.')
        entry.terminate()
        return
      }
      chunks.push(chunk)
      if (final) {
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength }
        files.set(path, bytes)
      }
    }
    entry.start()
  })
  unzip.register(UnzipInflate)
  try { unzip.push(source, true) }
  catch { throw new Error('The board archive is invalid.') }
  if (failure) throw failure
  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) throw new Error('The board archive has no manifest.')
  let manifest: unknown
  try { manifest = JSON.parse(strFromU8(manifestBytes)) }
  catch { throw new Error('The board manifest is invalid JSON.') }
  if (!record(manifest) || (manifest.formatVersion !== 2 && manifest.formatVersion !== 3)) throw new Error('The board archive format is unsupported.')
  if (!record(manifest.board) || typeof manifest.board.name !== 'string' || !manifest.board.name.trim() || manifest.board.name.length > 80
    || !timestamp(manifest.board.createdAt) || !timestamp(manifest.board.updatedAt)
    || !Array.isArray(manifest.panels) || !Array.isArray(manifest.notes) || !Array.isArray(manifest.images)
    || manifest.notes.length > MAX_NOTE_COUNT || manifest.images.length > MAX_IMAGE_COUNT) {
    throw new Error('The board manifest has invalid metadata.')
  }
  if (!validCanvas(manifest.canvas)) {
    throw new Error('The board manifest has invalid canvas data.')
  }
  const panelIds = new Set<string>()
  for (const panel of manifest.panels) {
    if (!record(panel) || !safeId(panel.id) || panelIds.has(panel.id) || typeof panel.type !== 'string' || !record(panel.config)) {
      throw new Error('The board manifest has invalid panels.')
    }
    panelIds.add(panel.id)
  }
  const referenced = new Set(['manifest.json'])
  const noteIds = new Set<string>()
  let noteBytes = 0
  for (const note of manifest.notes) {
    if (!record(note) || !safeId(note.id) || noteIds.has(note.id) || typeof note.title !== 'string'
      || !timestamp(note.createdAt) || !timestamp(note.updatedAt) || typeof note.path !== 'string'
      || !notePath(note.path) || !files.has(note.path) || referenced.has(note.path)) {
      throw new Error('The board manifest has an invalid note.')
    }
    noteIds.add(note.id)
    referenced.add(note.path)
    noteBytes += files.get(note.path)!.byteLength
  }
  if (noteBytes > MAX_TOTAL_NOTE_BYTES) throw new Error('The board notes exceed the size limit.')
  const imageIds = new Set<string>()
  for (const image of manifest.images) {
    if (!record(image) || !safeId(image.id) || imageIds.has(image.id) || typeof image.mimeType !== 'string'
      || !mimeExtensions[image.mimeType] || typeof image.path !== 'string'
      || image.path !== `images/${image.id}.${mimeExtensions[image.mimeType]}`
      || !files.has(image.path) || referenced.has(image.path)
      || image.size !== files.get(image.path)!.byteLength || typeof image.filename !== 'string'
      || !timestamp(image.lastModified)
      || !dimension(image.width) || !dimension(image.height)
      || (image.attribution !== undefined && !attribution(image.attribution))
      || (image.panelId !== undefined && (!safeId(image.panelId) || !panelIds.has(image.panelId)))
      || (image.panelId !== undefined && image.panelIds !== undefined)
      || (image.panelIds !== undefined && (!Array.isArray(image.panelIds) || !image.panelIds.length
        || new Set(image.panelIds).size !== image.panelIds.length
        || image.panelIds.some((id: unknown) => !safeId(id) || !panelIds.has(id))))) {
      throw new Error('The board manifest has an invalid image.')
    }
    imageIds.add(image.id)
    referenced.add(image.path)
  }
  for (const panel of manifest.panels) {
    if (panel.type === 'notes' && record(panel.config) && panel.config.activeNoteId !== null
      && !noteIds.has(panel.config.activeNoteId as string)) throw new Error('A Notes panel refers to a missing note.')
  }
  if (files.size !== referenced.size) throw new Error('The archive contains unreferenced files.')
}
