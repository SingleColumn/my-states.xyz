import { describe, expect, it, vi } from 'vitest'
import {
  bundledImageCollections,
  createImageItemsFromBundledCollection,
  getBundledCollection,
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
