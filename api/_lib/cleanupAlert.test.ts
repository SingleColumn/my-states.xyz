import { describe, expect, it, vi } from 'vitest'
import { alertOnCleanupFailure } from './cleanupAlert'

describe('cleanup failure notification', () => {
  it('sends only a generic event for a failed scheduled run', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    expect(await alertOnCleanupFailure(503, 'https://alerts.example.test/hook', fetcher)).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const request = vi.mocked(fetcher).mock.calls[0]
    expect(request[1]?.body).toContain('board-share-cleanup-failed')
    expect(request[1]?.body).not.toContain('shareId')
    expect(await alertOnCleanupFailure(200, 'https://alerts.example.test/hook', fetcher)).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
