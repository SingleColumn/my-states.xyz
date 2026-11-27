import { describe, expect, it } from 'vitest'
import { createBoardSharesHandler } from '../boardShares'
import { readShareConfig, type ShareConfig } from './shareConfig'
import type { ShareService } from './shareService'

const origin = 'https://trial.example.test'
const signingKey = 'cd'.repeat(32)
const config: ShareConfig = { endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, bucket: 'trial-bucket',
  accessKeyId: 'access-key-id', secretAccessKey: 'secret-access-key-long', sessionSigningKey: signingKey, allowedOrigin: origin,
  uploadOrigin: 'https://trial-upload.example.workers.dev' }
const request = (action: string, method = 'POST', body?: unknown, suppliedOrigin = origin, authorization?: string) =>
  new Request(`${origin}/api/boardShares?action=${action}${action === 'create' || action === 'cleanup' ? '' : `&id=${'a'.repeat(48)}`}`, { method,
    headers: { Origin: suppliedOrigin, ...(authorization ? { Authorization: authorization } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

describe('anonymous sharing API gates', () => {
  it('requires R2, origin, and operations key configuration, but no creator password', () => {
    const env = {
      BOARD_SHARE_R2_ENDPOINT: config.endpoint, BOARD_SHARE_R2_BUCKET: config.bucket,
      BOARD_SHARE_R2_ACCESS_KEY_ID: config.accessKeyId, BOARD_SHARE_R2_SECRET_ACCESS_KEY: config.secretAccessKey,
      BOARD_SHARE_SESSION_SIGNING_KEY: config.sessionSigningKey, BOARD_SHARE_ALLOWED_ORIGIN: config.allowedOrigin,
      BOARD_SHARE_UPLOAD_ORIGIN: config.uploadOrigin,
    }
    expect(readShareConfig(env).bucket).toBe('trial-bucket')
    expect(() => readShareConfig({ ...env, BOARD_SHARE_SESSION_SIGNING_KEY: 'bad' })).toThrow('BOARD_SHARE_SESSION_SIGNING_KEY format')
    expect(() => readShareConfig({ ...env, BOARD_SHARE_R2_BUCKET: undefined })).toThrow('BOARD_SHARE_R2_BUCKET is missing')
  })

  it('permits create and token-bound completion without a session and blocks public management', async () => {
    let created = 0
    let completed = 0
    const service = {
      async create(_length: number, _digest: string, source: string) {
        expect(source).toMatch(/^[a-f0-9]{64}$/); created++
        return { id: 'a'.repeat(48), uploadToken: 'token', url: 'https://r2.example.test/staging', headers: {} }
      },
      async complete(_id: string, token: string) {
        expect(token).toBe('token'); completed++
        return { id: 'a'.repeat(48), expiresAt: 1234 }
      },
      async reserveResolve() {},
      async resolve() { return { url: 'https://r2.example.test/final', byteLength: 1, sha256: 'a'.repeat(64) } },
      async disable() {},
      async cleanupScheduled() { return { removed: 0, backlog: false, lastSuccessAt: 1234 } },
    } as unknown as ShareService
    const handler = createBoardSharesHandler(() => config, () => service, () => '203.0.113.4')
    expect((await handler.fetch(request('create', 'POST', { byteLength: 1, sha256: 'a'.repeat(64) }))).status).toBe(201)
    expect((await handler.fetch(request('complete', 'POST', { uploadToken: 'token' }))).status).toBe(200)
    expect(created).toBe(1)
    expect(completed).toBe(1)
    expect((await handler.fetch(request('create', 'POST', {}, 'https://other.test'))).status).toBe(403)
    expect((await handler.fetch(request('disable'))).status).toBe(401)
    expect((await handler.fetch(request('cleanup'))).status).toBe(401)
    expect((await handler.fetch(request('dismiss'))).status).toBe(404)
    expect((await handler.fetch(request('login'))).status).toBe(404)
    expect((await handler.fetch(request('resolve', 'GET'))).status).toBe(200)
    expect((await handler.fetch(request('disable', 'POST', undefined, origin, `Bearer ${signingKey}`))).status).toBe(200)
    expect((await handler.fetch(request('cleanup', 'POST', undefined, origin, `Bearer ${signingKey}`))).status).toBe(200)
  })

  it('fails closed when the platform address is unavailable', async () => {
    const service = {} as ShareService
    const handler = createBoardSharesHandler(() => config, () => service, () => null)
    expect((await handler.fetch(request('create', 'POST', { byteLength: 1, sha256: 'a'.repeat(64) }))).status).toBe(503)
  })

  it('bounds streamed JSON bytes and validates type and exact action fields', async () => {
    let created = 0
    const service = { async create() { created++; return { id: 'a'.repeat(48) } } } as unknown as ShareService
    const handler = createBoardSharesHandler(() => config, () => service, () => '203.0.113.4')
    const url = `${origin}/api/boardShares?action=create`
    const body = JSON.stringify({ byteLength: 1, sha256: 'a'.repeat(64) })
    const call = (text: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }) =>
      handler.fetch(new Request(url, { method: 'POST', headers: { Origin: origin, ...headers }, body: text }))
    expect((await call(body)).status).toBe(201)
    expect((await call(body, { 'Content-Type': 'text/plain' })).status).toBe(415)
    expect((await call('{')).status).toBe(400)
    expect((await call(JSON.stringify({ byteLength: 1, sha256: 'a'.repeat(64), extra: true }))).status).toBe(400)
    expect((await call('é'.repeat(1025))).status).toBe(413)
    expect(created).toBe(1)

    for (const declared of [undefined, '1']) {
      let reads = 0
      let cancelled = false
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          reads++
          controller.enqueue(new Uint8Array(reads === 1 ? 2048 : 1))
        },
        cancel() { cancelled = true },
      })
      const response = await handler.fetch(new Request(url, { method: 'POST', duplex: 'half',
        headers: { Origin: origin, 'Content-Type': 'application/json', ...(declared ? { 'Content-Length': declared } : {}) }, body: stream,
      } as RequestInit))
      expect(response.status).toBe(413)
      expect(reads).toBeLessThanOrEqual(3)
      expect(cancelled).toBe(true)
    }
  })
})
