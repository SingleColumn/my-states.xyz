import type { ImageItem } from './types'

export const bundledImageCollections = [
  { id: 'teemu-jpeg', name: 'teemu-jpeg', basePath: '/sample-images/teemu-jpeg/' },
  { id: 'eightbitstrana', name: 'eightbitstrana', basePath: '/sample-images/eightbitstrana/' },
  { id: 'jaumecopilotos-ai', name: 'jaumecopilotos-ai', basePath: '/sample-images/jaumecopilotos-ai/' },
] as const

export type BundledImageCollectionId = (typeof bundledImageCollections)[number]['id']

interface ManifestCollection {
  id: string
  name: string
  images: string[]
}

export function getBundledCollections() {
  return bundledImageCollections
}

export function getBundledCollection(id: string) {
  return bundledImageCollections.find((collection) => collection.id === id)
}

export async function createImageItemsFromBundledCollection(
  id: string,
  fetchManifest: typeof fetch = fetch,
): Promise<ImageItem[] | null> {
  if (!getBundledCollection(id)) return null

  const response = await fetchManifest('/sample-images/manifest.json', { cache: 'no-cache' })
  if (!response.ok) throw new Error('Sample collections could not be loaded.')
  const manifest = await response.json() as unknown
  const collection = readManifestCollection(manifest, id)
  if (!collection) return []

  return collection.images.map((url, index) => {
    const filename = imageNameFromUrl(url)
    return {
      id: `bundled-${id}-${index}`,
      sessionId: null,
      filename,
      name: filename,
      mimeType: mimeTypeFromFilename(filename),
      size: 0,
      lastModified: 0,
      width: null,
      height: null,
      url,
      urlKind: 'static',
    }
  })
}

function readManifestCollection(value: unknown, id: string): ManifestCollection | null {
  if (!isRecord(value) || !Array.isArray(value.collections)) {
    throw new Error('The sample image manifest is invalid.')
  }
  const candidate = value.collections.find((item) => isRecord(item) && item.id === id)
  if (!candidate) return null
  if (typeof candidate.name !== 'string' || !Array.isArray(candidate.images) || !candidate.images.every(isValidImageUrl)) {
    throw new Error(`The sample collection "${id}" is invalid.`)
  }
  return { id, name: candidate.name, images: candidate.images }
}

function isValidImageUrl(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('/sample-images/')
    && /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(value)
}

function imageNameFromUrl(url: string) {
  const encoded = url.split('/').pop() ?? url
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

function mimeTypeFromFilename(filename: string) {
  const extension = filename.split('.').pop()?.toLowerCase()
  return ({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  } as Record<string, string | undefined>)[extension ?? ''] ?? 'application/octet-stream'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
