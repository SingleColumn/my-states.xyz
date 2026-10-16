import { describe, expect, it, vi } from 'vitest'
import {
  createImageItemsFromCuratedCollection,
  isSafeCuratedPath,
  loadCuratedCollectionCatalog,
  normalizeImageCollectionsBaseUrl,
} from './curatedImageCollections'

const base = 'https://cdn.example/export'
const publishedAt = '2026-10-02T08:00:00Z'

function entry(slug = 'autumn') {
  return {
    slug,
    title: 'Autumn',
    kind: 'creator',
    creator: 'rbnks',
    version: 3,
    published_at: publishedAt,
    count: 2,
    manifest: `collections/${slug}/latest.json`,
  }
}

function item(position: number, id = `image-${position}`) {
  return {
    position,
    id,
    file: `images/ab/${id}.jpg`,
    thumb: `thumbs/ab/${id}.webp`,
    width: 1200 + position,
    height: 1600 + position,
    source: position ? 'other.creator' : 'rbnks',
    source_url: `https://www.instagram.com/p/post-${position}/`,
    added_at: '2026-09-15T10:30:00Z',
  }
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    manifest_version: 1,
    slug: 'autumn',
    title: 'Autumn',
    kind: 'creator',
    creator: 'rbnks',
    version: 3,
    published_at: publishedAt,
    count: 2,
    items: [item(0), item(1)],
    ...overrides,
  }
}

function feedFetch(indexValue: unknown, manifests: Record<string, unknown | Error>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    expect(init?.cache).toBe('no-store')
    if (url === `${base}/collections/index.json`) return Response.json(indexValue)
    const value = manifests[url]
    if (value instanceof Error) throw value
    if (value === undefined) return new Response('', { status: 404 })
    return Response.json(value)
  }) as unknown as typeof fetch
}

describe('curated image collections', () => {
  it('normalizes the public base URL and rejects unsafe relative paths', () => {
    expect(normalizeImageCollectionsBaseUrl(' https://cdn.example/export/// ')).toBe(base)
    expect(normalizeImageCollectionsBaseUrl('')).toBeNull()
    for (const path of ['https://evil.example/a.jpg', '/images/a.jpg', 'images\\a.jpg', '../a.jpg', 'images/../a.jpg', 'images/%2e%2e/a.jpg', 'images/a%2Fb.jpg', 'images/a.jpg?x=1', 'images/a.jpg#x']) {
      expect(isSafeCuratedPath(path), path).toBe(false)
    }
    expect(isSafeCuratedPath('images/ab/photo.jpg')).toBe(true)
  })

  it('validates and converts the current index and manifests in curated order', async () => {
    const fetcher = feedFetch(
      { manifest_version: 1, generated_at: publishedAt, collections: [entry()] },
      { [`${base}/collections/autumn/latest.json`]: manifest() },
    )
    const catalog = await loadCuratedCollectionCatalog(`${base}/`, fetcher)
    expect(catalog.failedCollections).toBe(0)
    expect(catalog.failedCollectionSlugs).toEqual([])
    expect(catalog.collections).toEqual([expect.objectContaining({
      id: 'autumn',
      title: 'Autumn',
      coverUrl: `${base}/images/ab/image-0.jpg`,
      creators: ['rbnks', 'other.creator'],
      imageCount: 2,
    })])
    expect(catalog.collections[0].items.map((candidate) => candidate.id)).toEqual(['image-0', 'image-1'])

    const images = await createImageItemsFromCuratedCollection('autumn', base, fetcher)
    expect(images?.[0]).toMatchObject({
      id: 'curated-image-0',
      url: `${base}/images/ab/image-0.jpg`,
      urlKind: 'remote',
      filename: 'image-0.jpg',
      mimeType: 'image/jpeg',
      width: 1200,
      height: 1600,
      attribution: {
        creator: 'rbnks',
        creatorUrl: 'https://www.instagram.com/rbnks/',
        sourceUrl: 'https://www.instagram.com/p/post-0/',
      },
    })
  })

  it('rejects unsupported index versions and isolates unsupported manifest versions', async () => {
    await expect(loadCuratedCollectionCatalog(base, feedFetch(
      { manifest_version: 2, collections: [] },
      {},
    ))).rejects.toThrow('Image collections could not be loaded')

    const catalog = await loadCuratedCollectionCatalog(base, feedFetch(
      { manifest_version: 1, generated_at: publishedAt, collections: [entry()] },
      { [`${base}/collections/autumn/latest.json`]: manifest({ manifest_version: 2 }) },
    ))
    expect(catalog).toEqual({ collections: [], failedCollections: 1, failedCollectionSlugs: ['autumn'] })
  })

  it('never follows historical or otherwise non-current manifest paths', async () => {
    const fetcher = feedFetch(
      { manifest_version: 1, generated_at: publishedAt, collections: [{ ...entry(), manifest: 'collections/autumn/v3.json' }] },
      {},
    )
    const catalog = await loadCuratedCollectionCatalog(base, fetcher)
    expect(catalog).toEqual({ collections: [], failedCollections: 1, failedCollectionSlugs: [] })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('rejects index/manifest metadata, count, and position mismatches', async () => {
    for (const badManifest of [
      manifest({ title: 'Different' }),
      manifest({ count: 1 }),
      manifest({ items: [item(1), item(1)] }),
    ]) {
      const catalog = await loadCuratedCollectionCatalog(base, feedFetch(
        { manifest_version: 1, generated_at: publishedAt, collections: [entry()] },
        { [`${base}/collections/autumn/latest.json`]: badManifest },
      ))
      expect(catalog).toEqual({ collections: [], failedCollections: 1, failedCollectionSlugs: ['autumn'] })
    }
  })

  it('keeps healthy collections when another manifest fails or contains an unsafe asset path', async () => {
    const second = { ...entry('winter'), title: 'Winter', count: 1 }
    const third = { ...entry('spring'), title: 'Spring' }
    const catalog = await loadCuratedCollectionCatalog(base, feedFetch(
      { manifest_version: 1, generated_at: publishedAt, collections: [entry(), second, third] },
      {
        [`${base}/collections/autumn/latest.json`]: manifest(),
        [`${base}/collections/winter/latest.json`]: new Error('offline'),
        [`${base}/collections/spring/latest.json`]: manifest({ slug: 'spring', title: 'Spring', items: [{ ...item(0), file: '../secret.jpg' }, item(1)] }),
      },
    ))
    expect(catalog.collections.map((collection) => collection.id)).toEqual(['autumn'])
    expect(catalog.failedCollections).toBe(2)
    expect(catalog.failedCollectionSlugs).toEqual(['winter', 'spring'])
  })

  it('accepts an empty current collection and gives it no cover', async () => {
    const emptyEntry = { ...entry(), count: 0 }
    const catalog = await loadCuratedCollectionCatalog(base, feedFetch(
      { manifest_version: 1, generated_at: publishedAt, collections: [emptyEntry] },
      { [`${base}/collections/autumn/latest.json`]: manifest({ count: 0, items: [] }) },
    ))
    expect(catalog.collections[0]).toMatchObject({ coverUrl: null, creators: [], imageCount: 0, items: [] })
  })

  it('returns no replacement when a saved curated slug has been removed', async () => {
    const fetcher = feedFetch({ manifest_version: 1, generated_at: publishedAt, collections: [] }, {})
    await expect(createImageItemsFromCuratedCollection('removed-collection', base, fetcher)).resolves.toBeNull()
  })
})
