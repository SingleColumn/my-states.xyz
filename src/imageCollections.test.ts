import { describe, expect, it, vi } from 'vitest'
import { createImageItemsFromBundledCollection, loadBundledCollections } from './imageCollections'

interface ManifestCollectionFixture {
  id: string
  title: string
  cover?: string | null
  images: { url: string; creator: string; creatorUrl?: string; sourceUrl?: string }[]
}

function manifestFetch(...collections: ManifestCollectionFixture[]) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      collections: collections.map((collection) => ({ cover: null, ...collection })),
    }),
  } as Response))
}

const cover = '/sample-images/neon-cities/cover.jpg'

describe('bundled image collections', () => {
  it('reads the collections out of the manifest rather than a list in the code', async () => {
    const collections = await loadBundledCollections(manifestFetch(
      { id: 'neon-cities', title: 'Neon Cities', cover, images: [{ url: cover, creator: 'Ada' }] },
      { id: 'quiet-rooms', title: 'Quiet Rooms', images: [] },
    ))
    expect(collections).toEqual([
      { id: 'neon-cities', title: 'Neon Cities', coverUrl: cover, imageCount: 1 },
      { id: 'quiet-rooms', title: 'Quiet Rooms', coverUrl: null, imageCount: 0 },
    ])
  })

  it('falls back to the first image when a collection names no cover', async () => {
    const first = '/sample-images/neon-cities/first.jpg'
    const [collection] = await loadBundledCollections(manifestFetch(
      { id: 'neon-cities', title: 'Neon Cities', images: [{ url: first, creator: 'Ada' }] },
    ))
    expect(collection.coverUrl).toBe(first)
  })

  it('returns null for a collection the manifest does not carry', async () => {
    await expect(createImageItemsFromBundledCollection('removed-pack', manifestFetch())).resolves.toBeNull()
  })

  it('carries every credit through to the image it belongs to', async () => {
    const items = await createImageItemsFromBundledCollection('neon-cities', manifestFetch({
      id: 'neon-cities',
      title: 'Neon Cities',
      images: [
        {
          url: '/sample-images/neon-cities/01%20cover.webp',
          creator: 'Ada',
          creatorUrl: 'https://example.com/ada',
          sourceUrl: 'https://example.com/post',
        },
        { url: '/sample-images/neon-cities/02.jpg', creator: 'Grace' },
      ],
    }))

    expect(items).toEqual([
      expect.objectContaining({
        name: '01 cover.webp',
        mimeType: 'image/webp',
        url: '/sample-images/neon-cities/01%20cover.webp',
        urlKind: 'static',
        attribution: { creator: 'Ada', creatorUrl: 'https://example.com/ada', sourceUrl: 'https://example.com/post' },
      }),
      expect.objectContaining({ attribution: { creator: 'Grace' } }),
    ])
  })

  it('rejects a manifest whose images are not credited', async () => {
    const uncredited = manifestFetch({
      id: 'neon-cities',
      title: 'Neon Cities',
      images: [{ url: '/sample-images/neon-cities/01.jpg' } as ManifestCollectionFixture['images'][number]],
    })
    await expect(loadBundledCollections(uncredited)).rejects.toThrow('The sample image manifest is invalid.')
  })
})
