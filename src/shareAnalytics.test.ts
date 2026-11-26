import { describe, expect, it } from 'vitest'
import { redactShareAnalytics } from './shareAnalytics'

describe('share analytics redaction', () => {
  it('redacts route and nested initial, referrer, and error properties without changing other URLs', () => {
    const id = 'a'.repeat(48)
    const event = { url: `https://example.test/share/${id}`, properties: {
      $current_url: `https://example.test/share/${id}?from=mail`,
      $initial_pathname: `/share/${id}`,
      $referrer: `https://example.test/share/${id}/`,
      error: { message: `From /share/${id}` },
      [`https://example.test/share/${id}`]: 'dynamic key',
      other: 'https://example.test/boards',
    } }
    const safe = redactShareAnalytics(event)
    expect(JSON.stringify(safe)).not.toContain(id)
    expect(safe.url).toBe('https://example.test/share/:id')
    expect(safe.properties.other).toBe('https://example.test/boards')
  })
})
