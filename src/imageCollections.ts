import type { ImageItem } from './types'

/* Collections are named after the Instagram profile of the creator whose work
   they contain, so the name is a credit and is never shortened or replaced.
   `cover` names the image that represents the collection on screen; leaving it
   null falls back to whichever file sorts first, which is rarely the best one. */
export const bundledImageCollections = [
  {
    id: 'teemu-jpeg',
    name: 'teemu-jpeg',
    basePath: '/sample-images/teemu-jpeg/',
    cover: '/sample-images/teemu-jpeg/teemu_jpeg_BaLy4m7ATYt_0.jpg',
  },
  {
    id: 'eightbitstrana',
    name: 'eightbitstrana',
    basePath: '/sample-images/eightbitstrana/',
    cover: '/sample-images/eightbitstrana/eightbitstrana_DF-os2-NtPL_0.jpg',
  },
  {
    id: 'jaumecopilotos-ai',
    name: 'jaumecopilotos-ai',
    basePath: '/sample-images/jaumecopilotos-ai/',
    cover: '/sample-images/jaumecopilotos-ai/jaumecopilotos_ai_DC3nykmC5TJ_0.webp',
  },
] as const

export type BundledImageCollectionId = (typeof bundledImageCollections)[number]['id']

export interface BundledCollectionPreview {
  id: string
  coverUrl: string | null
}

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

  const manifest = await fetchManifestDocument(fetchManifest)
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

/**
 * The cover image for every registered collection, read from the generated
 * manifest so a card can never point at a file that is not on disk.
 */
export async function loadBundledCollectionPreviews(
  fetchManifest: typeof fetch = fetch,
): Promise<BundledCollectionPreview[]> {
  const manifest = await fetchManifestDocument(fetchManifest)

  return bundledImageCollections.map((collection) => {
    const images = readManifestCollection(manifest, collection.id)?.images ?? []
    const cover: string = collection.cover
    return {
      id: collection.id,
      coverUrl: images.includes(cover) ? cover : images[0] ?? null,
    }
  })
}

async function fetchManifestDocument(fetchManifest: typeof fetch): Promise<unknown> {
  const response = await fetchManifest('/sample-images/manifest.json', { cache: 'no-cache' })
  if (!response.ok) throw new Error('Sample collections could not be loaded.')
  return await response.json() as unknown
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
