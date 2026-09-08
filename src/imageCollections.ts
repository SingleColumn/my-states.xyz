import type { ImageAttribution, ImageItem } from './types'

/* Collections describe themselves: each folder under public/sample-images
   carries a collection.json naming the collection and crediting every picture
   in it, and the build turns those into the manifest read here. Nothing about
   the set of collections is written down in this file, so adding one is a
   matter of dropping a folder in. */

export interface BundledCollection {
  id: string
  title: string
  coverUrl: string | null
  imageCount: number
}

interface ManifestImage extends ImageAttribution {
  url: string
}

interface ManifestCollection {
  id: string
  title: string
  cover: string | null
  images: ManifestImage[]
}

export async function loadBundledCollections(
  fetchManifest: typeof fetch = fetch,
): Promise<BundledCollection[]> {
  const collections = await readManifest(fetchManifest)
  return collections.map(({ id, title, cover, images }) => ({
    id,
    title,
    coverUrl: cover ?? images[0]?.url ?? null,
    imageCount: images.length,
  }))
}

export async function createImageItemsFromBundledCollection(
  id: string,
  fetchManifest: typeof fetch = fetch,
): Promise<ImageItem[] | null> {
  const collection = (await readManifest(fetchManifest)).find((candidate) => candidate.id === id)
  if (!collection) return null

  return collection.images.map(({ url, ...attribution }, index) => {
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
      urlKind: 'static' as const,
      attribution,
    }
  })
}

async function readManifest(fetchManifest: typeof fetch): Promise<ManifestCollection[]> {
  const response = await fetchManifest('/sample-images/manifest.json', { cache: 'no-cache' })
  if (!response.ok) throw new Error('Sample collections could not be loaded.')
  const value = await response.json() as unknown

  if (!isRecord(value) || !Array.isArray(value.collections)) {
    throw new Error('The sample image manifest is invalid.')
  }
  return value.collections.map(readManifestCollection)
}

function readManifestCollection(value: unknown): ManifestCollection {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || (value.cover !== null && typeof value.cover !== 'string')
    || !Array.isArray(value.images)
    || !value.images.every(isValidManifestImage)
  ) {
    throw new Error('The sample image manifest is invalid.')
  }
  return { id: value.id, title: value.title, cover: value.cover, images: value.images }
}

function isValidManifestImage(value: unknown): value is ManifestImage {
  return isRecord(value)
    && typeof value.url === 'string'
    && value.url.startsWith('/sample-images/')
    && /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(value.url)
    && typeof value.creator === 'string'
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
