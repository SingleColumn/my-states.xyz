import { describe, expect, it, vi } from 'vitest'
import {
  bundledImageCollections,
  createImageItemsFromBundledCollection,
  getBundledCollection,
  loadBundledCollectionPreviews,
} from './imageCollections'

function manifestFetch(images: string[]) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ collections: [{ id: 'teemu-jpeg', name: 'teemu-jpeg', images }] }),
  } as Response))
}

describe('bundled image collection registry', () => {
  it('registers exactly the three stable collection IDs', () => {
    expect(bundledImageCollections.map(({ id }) => id)).toEqual([
      'teemu-jpeg',
      'eightbitstrana',
      'jaumecopilotos-ai',
    ])
  })

  it('resolves a valid ID and rejects an unknown ID without fetching', async () => {
    expect(getBundledCollection('eightbitstrana')?.name).toBe('eightbitstrana')
    const fetchManifest = manifestFetch([])
    await expect(createImageItemsFromBundledCollection('removed-pack', fetchManifest)).resolves.toBeNull()
    expect(fetchManifest).not.toHaveBeenCalled()
  })

  it('handles an empty collection and converts manifest URLs to static ImageItems', async () => {
    await expect(createImageItemsFromBundledCollection('teemu-jpeg', manifestFetch([]))).resolves.toEqual([])
    const items = await createImageItemsFromBundledCollection(
      'teemu-jpeg',
      manifestFetch(['/sample-images/teemu-jpeg/01%20cover.webp']),
    )
    expect(items).toEqual([expect.objectContaining({
      name: '01 cover.webp',
      mimeType: 'image/webp',
      url: '/sample-images/teemu-jpeg/01%20cover.webp',
      urlKind: 'static',
    })])
  })
})

describe('collection previews', () => {
  const curatedCover = bundledImageCollections[0].cover

  it('prefers the curated cover over the first image on disk', async () => {
    const [preview] = await loadBundledCollectionPreviews(
      manifestFetch(['/sample-images/teemu-jpeg/first.jpg', curatedCover]),
    )
    expect(preview).toEqual({ id: 'teemu-jpeg', coverUrl: curatedCover })
  })

  it('falls back to the first image when the curated cover is missing', async () => {
    const [preview] = await loadBundledCollectionPreviews(
      manifestFetch(['/sample-images/teemu-jpeg/first.jpg']),
    )
    expect(preview).toMatchObject({ coverUrl: '/sample-images/teemu-jpeg/first.jpg' })
  })

  it('reports every registered collection, including ones absent from the manifest', async () => {
    const previews = await loadBundledCollectionPreviews(manifestFetch([]))
    expect(previews.map(({ id }) => id)).toEqual(bundledImageCollections.map(({ id }) => id))
    expect(previews[1]).toEqual({ id: 'eightbitstrana', coverUrl: null })
  })
})
