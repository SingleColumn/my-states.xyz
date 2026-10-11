import { describe, expect, it, vi } from 'vitest'
import { loadFeaturedImageCollections } from './collectionSource'

describe('featured image collection source', () => {
  it('does not fall back to bundled samples when a configured source fails', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('', { status: 503 }))
    const fetcher = request as unknown as typeof fetch
    await expect(loadFeaturedImageCollections('https://cdn.example/export', fetcher)).rejects.toThrow('Image collections could not be loaded')
    expect(request).toHaveBeenCalledOnce()
    expect(String(request.mock.calls[0][0])).toBe('https://cdn.example/export/collections/index.json')
  })
})
