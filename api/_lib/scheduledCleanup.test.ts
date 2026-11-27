import { describe, expect, it, vi } from 'vitest'
import { createBoardSharesHandler } from '../boardShares'
import { scheduledCleanupRequest } from './scheduledCleanup'

const key = 'a'.repeat(64)
const config = {
  endpoint: `https://${'b'.repeat(32)}.r2.cloudflarestorage.com`, bucket: 'board-shares',
  accessKeyId: 'x'.repeat(10), secretAccessKey: 'y'.repeat(20), sessionSigningKey: key,
  allowedOrigin: 'https://www.example.test', uploadOrigin: 'https://upload.example.test',
}
const scheduledPath = 'https://app.example.test/api/boardShareCleanup'
const bearer = { authorization: `Bearer ${key}` }
const emptyStream = () => new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })

function setup() {
  const cleanupScheduled = vi.fn(async () => ({ removed: 0, backlog: false, lastSuccessAt: 1 }))
  const cleanup = vi.fn(async () => ({ removed: 0 }))
  const handler = createBoardSharesHandler(() => config, () => ({ cleanupScheduled, cleanup }) as never, () => '192.0.2.1')
  return { handler, cleanupScheduled, cleanup }
}

// Every way an empty scheduler POST can be framed. The Production run on
// 2026-11-27 was one of the shapes that previously reached the JSON check (415).
const shapes: Array<[string, (headers: Record<string, string>) => Request]> = [
  ['no body', (headers) => new Request(scheduledPath, { method: 'POST', headers })],
  ['Content-Length 0', (headers) => new Request(scheduledPath, { method: 'POST', headers: { ...headers, 'content-length': '0' }, body: '' })],
  ['empty stream, no length', (headers) => new Request(scheduledPath, { method: 'POST', headers, body: emptyStream(), duplex: 'half' } as RequestInit)],
  ['text/plain, empty', (headers) => new Request(scheduledPath, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: '' })],
  ['octet-stream, empty stream', (headers) => new Request(scheduledPath, { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: emptyStream(), duplex: 'half' } as RequestInit)],
]

describe('scheduled cleanup requests', () => {
  it.each(shapes)('runs the scheduled cleanup for %s', async (_shape, make) => {
    const { handler, cleanupScheduled, cleanup } = setup()
    const response = await handler.fetch(scheduledCleanupRequest(make(bearer)))
    expect(response.status).toBe(200)
    expect(cleanupScheduled).toHaveBeenCalledTimes(1)
    expect(cleanup).not.toHaveBeenCalled()
  })

  it.each(shapes)('still refuses %s without the operations key', async (_shape, make) => {
    const { handler, cleanupScheduled } = setup()
    expect((await handler.fetch(scheduledCleanupRequest(make({})))).status).toBe(401)
    expect((await handler.fetch(scheduledCleanupRequest(make({ authorization: `Bearer ${'c'.repeat(64)}` })))).status).toBe(401)
    expect(cleanupScheduled).not.toHaveBeenCalled()
  })

  it('forwards only the method and the bearer key to the cleanup action', () => {
    const forwarded = scheduledCleanupRequest(new Request(`${scheduledPath}?stagingCursor=x`, {
      method: 'POST', body: '{"stagingCursor":"x"}',
      headers: { ...bearer, 'content-type': 'application/json', cookie: 'a=b', 'x-extra': '1' },
    }))
    expect(forwarded.url).toBe('https://app.example.test/api/boardShares?action=cleanup')
    expect(forwarded.method).toBe('POST')
    expect(forwarded.body).toBeNull()
    expect([...forwarded.headers.keys()]).toEqual(['authorization'])
    expect(forwarded.headers.get('authorization')).toBe(bearer.authorization)
  })

  it('does not turn a GET into a cleanup', async () => {
    const { handler, cleanupScheduled } = setup()
    expect((await handler.fetch(scheduledCleanupRequest(new Request(scheduledPath, { headers: bearer })))).status).toBe(404)
    expect(cleanupScheduled).not.toHaveBeenCalled()
  })
})
