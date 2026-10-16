import type { CollectionSummary } from './imageCollections'
import type { ImageAttribution, ImageItem } from './types'

export const curatedManifestVersion = 1

export interface CuratedCollectionItem {
  id: string
  filePath: string
  thumbPath: string
  fileUrl: string
  thumbUrl: string
  filename: string
  mimeType: string
  width: number
  height: number
  attribution: ImageAttribution
}

export interface CuratedCollection extends CollectionSummary {
  imageCount: number
  version: number
  items: CuratedCollectionItem[]
}

export interface CuratedCollectionCatalog {
  collections: CuratedCollection[]
  /** A bad selection is isolated from healthy selections and kept out of the UI. */
  failedCollections: number
  failedCollectionSlugs: string[]
}

interface CuratedIndexEntry {
  slug: string
  title: string
  kind: 'creator' | 'theme'
  creator: string | null
  version: number
  publishedAt: string
  count: number
  manifest: string
}

const imageMimeTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

const catalogRequests = new Map<string, Promise<CuratedCollectionCatalog>>()

export function normalizeImageCollectionsBaseUrl(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\/+$/, '') ?? ''
  return normalized || null
}

export const configuredImageCollectionsBaseUrl = normalizeImageCollectionsBaseUrl(import.meta.env.VITE_IMAGE_COLLECTIONS_BASE_URL)

export function isSafeCuratedPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('?') || value.includes('#') || value.includes('//')) return false
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return false
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  return !decoded.startsWith('/')
    && !decoded.includes('\\')
    && !decoded.includes('?')
    && !decoded.includes('#')
    && !/[\u0000-\u001f]/.test(decoded)
    && !/%2f/i.test(value)
    && !decoded.split('/').some((segment) => segment === '..' || segment === '.')
}

export function resolveCuratedPath(baseUrl: string, path: string) {
  if (!isSafeCuratedPath(path)) throw new Error('The image collection contains an unsafe file path.')
  return `${baseUrl}/${path}`
}

export function clearCuratedCollectionCache(baseUrl?: string) {
  if (baseUrl) catalogRequests.delete(baseUrl)
  else catalogRequests.clear()
}

export function loadCuratedCollectionCatalog(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<CuratedCollectionCatalog> {
  // Panels share the same current-state request. Injected fetches remain
  // uncached so validation tests and archive exports control every response.
  if (fetcher !== fetch) return fetchCuratedCollectionCatalog(baseUrl, fetcher)
  const existing = catalogRequests.get(baseUrl)
  if (existing) return existing
  const request = fetchCuratedCollectionCatalog(baseUrl, fetcher).catch((error: unknown) => {
    catalogRequests.delete(baseUrl)
    throw error
  })
  catalogRequests.set(baseUrl, request)
  return request
}

export async function createImageItemsFromCuratedCollection(
  slug: string,
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<ImageItem[] | null> {
  const catalog = await loadCuratedCollectionCatalog(baseUrl, fetcher)
  const collection = catalog.collections.find((candidate) => candidate.id === slug)
  if (catalog.failedCollectionSlugs.includes(slug)) throw new Error('This image collection could not be loaded. Please try again.')
  if (!collection) return null
  return collection.items.map((item) => ({
    id: `curated-${item.id}`,
    boardId: null,
    filename: item.filename,
    name: item.filename,
    mimeType: item.mimeType,
    size: 0,
    lastModified: 0,
    width: item.width,
    height: item.height,
    url: item.fileUrl,
    urlKind: 'remote' as const,
    attribution: item.attribution,
  }))
}

async function fetchCuratedCollectionCatalog(baseUrl: string, fetcher: typeof fetch): Promise<CuratedCollectionCatalog> {
  const normalizedBaseUrl = normalizeImageCollectionsBaseUrl(baseUrl)
  if (!normalizedBaseUrl) throw new Error('Image collections are not configured.')

  const indexValue = await fetchJson(
    resolveCuratedPath(normalizedBaseUrl, 'collections/index.json'),
    fetcher,
    'Image collections could not be loaded. Check the connection and try again.',
  )
  const { entries, rejectedEntries } = readIndex(indexValue)
  const results = await Promise.allSettled(entries.map(async (entry) => {
    const value = await fetchJson(
      resolveCuratedPath(normalizedBaseUrl, entry.manifest),
      fetcher,
      'An image collection could not be loaded.',
    )
    return readManifest(value, entry, normalizedBaseUrl)
  }))
  const collections = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const failedCollections = rejectedEntries + results.filter((result) => result.status === 'rejected').length
  const failedCollectionSlugs = results.flatMap((result, index) => result.status === 'rejected' ? [entries[index].slug] : [])
  return { collections, failedCollections, failedCollectionSlugs }
}

async function fetchJson(url: string, fetcher: typeof fetch, message: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, { cache: 'no-store' })
  } catch {
    throw new Error(message)
  }
  if (!response.ok) throw new Error(message)
  try {
    return await response.json() as unknown
  } catch {
    throw new Error(message)
  }
}

function readIndex(value: unknown): { entries: CuratedIndexEntry[]; rejectedEntries: number } {
  if (!isRecord(value) || value.manifest_version !== curatedManifestVersion || !isDateString(value.generated_at) || !Array.isArray(value.collections)) {
    throw new Error('Image collections could not be loaded. Check the connection and try again.')
  }
  const entries: CuratedIndexEntry[] = []
  const slugs = new Set<string>()
  let rejectedEntries = 0
  for (const candidate of value.collections) {
    const entry = readIndexEntry(candidate)
    if (!entry || slugs.has(entry.slug)) {
      rejectedEntries += 1
      continue
    }
    slugs.add(entry.slug)
    entries.push(entry)
  }
  return { entries, rejectedEntries }
}

function readIndexEntry(value: unknown): CuratedIndexEntry | null {
  if (!isRecord(value)) return null
  const slug = readSlug(value.slug)
  const kind = value.kind === 'creator' || value.kind === 'theme' ? value.kind : null
  const creator = value.creator === null || isCreator(value.creator) ? value.creator : undefined
  if (
    !slug
    || typeof value.title !== 'string' || !value.title.trim()
    || !kind
    || creator === undefined
    || (kind === 'creator' && creator === null)
    || (kind === 'theme' && creator !== null)
    || !isPositiveInteger(value.version)
    || !isDateString(value.published_at)
    || !isNonNegativeInteger(value.count)
    || value.manifest !== `collections/${slug}/latest.json`
    || !isSafeCuratedPath(value.manifest)
  ) return null
  return {
    slug,
    title: value.title.trim(),
    kind,
    creator,
    version: value.version,
    publishedAt: value.published_at,
    count: value.count,
    manifest: value.manifest,
  }
}

function readManifest(value: unknown, entry: CuratedIndexEntry, baseUrl: string): CuratedCollection {
  if (
    !isRecord(value)
    || value.manifest_version !== curatedManifestVersion
    || value.slug !== entry.slug
    || value.title !== entry.title
    || value.kind !== entry.kind
    || value.creator !== entry.creator
    || value.version !== entry.version
    || value.published_at !== entry.publishedAt
    || value.count !== entry.count
    || !Array.isArray(value.items)
    || value.count !== value.items.length
  ) throw new Error('An image collection is invalid.')

  const ids = new Set<string>()
  const items = value.items.map((candidate, index) => {
    const item = readManifestItem(candidate, index, baseUrl)
    if (!item || ids.has(item.id)) throw new Error('An image collection is invalid.')
    ids.add(item.id)
    return item
  })
  return {
    id: entry.slug,
    title: entry.title,
    coverUrl: items[0]?.thumbUrl ?? null,
    // The grid draws covers far larger than the stored thumbnail, so it uses the
    // full picture; the carousel keeps the thumbnail to stay light as it rotates.
    gridCoverUrl: items[0]?.fileUrl ?? null,
    creators: [...new Set(items.map((item) => item.attribution.creator))],
    imageCount: entry.count,
    version: entry.version,
    items,
  }
}

function readManifestItem(value: unknown, index: number, baseUrl: string): CuratedCollectionItem | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value.id) ? value.id : null
  const filePath = typeof value.file === 'string' && isSafeCuratedPath(value.file) && value.file.startsWith('images/') ? value.file : null
  const thumbPath = typeof value.thumb === 'string' && isSafeCuratedPath(value.thumb) && value.thumb.startsWith('thumbs/') ? value.thumb : null
  const mimeType = filePath ? mimeTypeFromPath(filePath) : null
  if (
    value.position !== index
    || !id || !filePath || !thumbPath || !mimeType
    || !isPositiveInteger(value.width) || !isPositiveInteger(value.height)
    || !isCreator(value.source)
    || !isHttpsUrl(value.source_url)
    || (value.added_at !== undefined && !isDateString(value.added_at))
  ) return null

  return {
    id,
    filePath,
    thumbPath,
    fileUrl: resolveCuratedPath(baseUrl, filePath),
    thumbUrl: resolveCuratedPath(baseUrl, thumbPath),
    filename: filenameFromPath(filePath),
    mimeType,
    width: value.width,
    height: value.height,
    attribution: {
      creator: value.source,
      creatorUrl: `https://www.instagram.com/${value.source}/`,
      sourceUrl: value.source_url,
    },
  }
}

function filenameFromPath(path: string) {
  const encoded = path.split('/').pop() ?? path
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

function mimeTypeFromPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return imageMimeTypes[extension] ?? null
}

function readSlug(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null
}

function isCreator(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(value)
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
