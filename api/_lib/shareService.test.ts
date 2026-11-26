import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { PENDING_MS, SHARE_MS, ShareService } from './shareService'
import type { ShareR2 } from './shareR2'

const source = 'a'.repeat(64)
const otherSource = 'b'.repeat(64)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const boardZip = () => zipSync({ 'manifest.json': strToU8(JSON.stringify({
  formatVersion: 3, board: { name: 'Shared test', createdAt: 1, updatedAt: 2 },
  panels: [], canvas: null, notes: [], images: [],
})) })
const conflict = () => ({ $metadata: { httpStatusCode: 412 } })

class MemoryR2 {
  objects = new Map<string, { bytes: Uint8Array; etag: string }>()
  serial = 0
  copied = 0
  get failDelete() { return this._failDelete }
  set failDelete(value: boolean) { this._failDelete = value }
  private _failDelete = false
  putRaw(key: string, bytes: Uint8Array) { this.objects.set(key, { bytes, etag: `"${++this.serial}"` }) }
  async read(key: string, limit: number) {
    const found = this.objects.get(key)
    if (!found) return null
    if (found.bytes.length > limit) throw new Error('too large')
    return found
  }
  async head(key: string) {
    const found = this.objects.get(key)
    return found ? { size: found.bytes.length, etag: found.etag } : null
  }
  async putJson(key: string, value: unknown, condition: { none?: true; etag?: string }) {
    const found = this.objects.get(key)
    if ((condition.none && found) || (condition.etag && found?.etag !== condition.etag)) throw conflict()
    this.putRaw(key, strToU8(JSON.stringify(value)))
  }
  async delete(key: string) { if (this._failDelete) throw new Error('temporary delete failure'); this.objects.delete(key) }
  async copyCreateOnly(sourceKey: string, destination: string, sourceEtag: string) {
    if (this.objects.has(destination) || this.objects.get(sourceKey)?.etag !== sourceEtag) throw conflict()
    this.putRaw(destination, this.objects.get(sourceKey)!.bytes)
    this.copied++
  }
  async uploadTarget(_key: string, id: string, token: string) { return { url: `https://upload.example.test/upload/${id}`, headers: { 'Content-Type': 'application/zip', Authorization: `Bearer ${token}` } } }
  async signedGet(key: string, expiresIn = 120) { return `https://example.test/${key}?seconds=${expiresIn}` }
  async list(prefix: string, cursor?: string, limit = 100) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort()
    // Stable lexical cursor: deleting an earlier page cannot restart a scan.
    const start = cursor ? Math.max(0, keys.findIndex((key) => key > cursor)) : 0
    const page = keys.slice(start, start + limit)
    return { keys: page, ...(start + limit < keys.length ? { cursor: page.at(-1) } : {}) }
  }
  status(id: string) { return JSON.parse(new TextDecoder().decode(this.objects.get(`shares/${id}/status.json`)!.bytes)) }
}

function setup() {
  const r2 = new MemoryR2()
  let now = 1_800_000_000_000
  const service = new ShareService(r2 as unknown as ShareR2, () => now)
  return { r2, service, clock: (value: number) => { now = value }, now: () => now }
}
async function pending(r2: MemoryR2, service: ShareService, bytes = boardZip(), from = source) {
  const created = await service.create(bytes.length, digest(bytes), from)
  return { created, status: r2.status(created.id), bytes }
}

describe('anonymous share status and limits', () => {
  it('publishes once with token authorization and expires 24 hours after first publication', async () => {
    const { r2, service, clock, now } = setup()
    const { created, status, bytes } = await pending(r2, service)
    await expect(service.complete(created.id, '0'.repeat(64))).rejects.toMatchObject({ status: 403 })
    await expect(service.resolve(created.id)).rejects.toMatchObject({ status: 409 })
    r2.putRaw(status.stagingKey, bytes)
    clock(now() + 9000)
    const published = await service.complete(created.id, created.uploadToken)
    expect(published.publishedAt).toBe(now())
    expect(published.expiresAt).toBe(now() + SHARE_MS)
    expect((await service.complete(created.id, created.uploadToken)).expiresAt).toBe(published.expiresAt)
    expect(r2.copied).toBe(1)
    expect((await service.resolve(created.id)).url).toContain('seconds=120')
    clock(published.expiresAt! - 30_000)
    expect((await service.resolve(created.id)).url).toContain('seconds=25')
    clock(published.expiresAt! - 4_000)
    await expect(service.resolve(created.id)).rejects.toMatchObject({ status: 410, message: 'This share has expired.' })
    clock(published.expiresAt!)
    await expect(service.resolve(created.id)).rejects.toMatchObject({ status: 410 })
  })

  it('rejects wrong length, digest, malformed ZIP, expired pending, and oversized declarations', async () => {
    const { r2, service, clock } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, bytes.slice(1))
    await expect(service.complete(created.id, created.uploadToken)).rejects.toMatchObject({ status: 422 })
    r2.putRaw(status.stagingKey, new Uint8Array(bytes.length))
    await expect(service.complete(created.id, created.uploadToken)).rejects.toMatchObject({ status: 422 })
    const corrupt = strToU8('not a zip')
    const other = await pending(r2, service, corrupt)
    r2.putRaw(other.status.stagingKey, corrupt)
    await expect(service.complete(other.created.id, other.created.uploadToken)).rejects.toMatchObject({ status: 422 })
    await expect(service.create(32 * 1024 * 1024 + 1, 'a'.repeat(64), source)).rejects.toMatchObject({ status: 400 })
    clock(status.uploadDeadline + 1)
    await expect(service.complete(created.id, created.uploadToken)).rejects.toMatchObject({ status: 410 })
  })

  it('bounds repeated expensive confirmation attempts', async () => {
    const { r2, service } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, new Uint8Array(bytes.length))
    for (let i = 0; i < 5; i++)
      await expect(service.complete(created.id, created.uploadToken)).rejects.toMatchObject({ status: 422 })
    await expect(service.complete(created.id, created.uploadToken)).rejects.toMatchObject({ status: 429 })
    expect(r2.status(created.id).completionAttempts).toBe(5)
  })

  it('uses conditional reservations under concurrent attempts and releases pending slots after deadline', async () => {
    const { r2, service, clock, now } = setup()
    const bytes = boardZip()
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => service.create(bytes.length, digest(bytes), source)))
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(4)
    expect(attempts.filter((item) => item.status === 'rejected')).toHaveLength(1)
    clock(now() + PENDING_MS + 1)
    await expect(service.create(bytes.length, digest(bytes), source)).resolves.toHaveProperty('uploadToken')
    expect(r2.objects.has('trial/share-usage-v1.json')).toBe(true)
    for (let i = 0; i < 9; i++) await service.create(bytes.length, digest(bytes), otherSource).catch(() => undefined)
    await expect(service.create(bytes.length, digest(bytes), otherSource)).rejects.toMatchObject({ status: 429 })
  })

  it('enforces the global byte allowance under simultaneous reservations', async () => {
    const { service } = setup()
    const attempts = await Promise.allSettled(Array.from({ length: 17 }, (_, index) =>
      service.create(32 * 1024 * 1024, 'c'.repeat(64), index.toString(16).padStart(64, '0'))))
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(16)
    expect(attempts.filter((item) => item.status === 'rejected')).toHaveLength(1)
  })

  it('caps global pending uploads and rolling-day share count', async () => {
    const { service, clock, now } = setup()
    for (let wave = 0; wave < 5; wave++) {
      for (let slot = 0; slot < 20; slot++) {
        const index = wave * 20 + slot
        await service.create(1, 'c'.repeat(64), index.toString(16).padStart(64, '0'))
      }
      const extra = (100 + wave).toString(16).padStart(64, '0')
      await expect(service.create(1, 'c'.repeat(64), extra)).rejects.toMatchObject({ status: 429 })
      if (wave < 4) clock(now() + PENDING_MS + 60_000)
    }
  })

  it('keeps staging for repair without extending a published link', async () => {
    const { r2, service, clock } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, bytes)
    const first = await service.complete(created.id, created.uploadToken)
    r2.putRaw(status.stagingKey, bytes)
    expect((await service.complete(created.id, created.uploadToken)).expiresAt).toBe(first.expiresAt)
    expect(r2.copied).toBe(1)
    await service.cleanup()
    expect(r2.objects.has(status.stagingKey)).toBe(true)
    r2.objects.delete(status.finalKey)
    await expect(service.resolve(created.id)).resolves.toHaveProperty('url')
    expect(r2.objects.has(status.finalKey)).toBe(true)
    clock(first.expiresAt! + 1)
    await service.cleanup()
    expect(r2.objects.has(status.stagingKey)).toBe(false)
  })

  it('does not restore a share disabled during completion', async () => {
    const { r2, service } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, bytes)
    const original = r2.copyCreateOnly.bind(r2)
    r2.copyCreateOnly = async (from, to, etag) => {
      await original(from, to, etag)
      await service.disable(created.id)
    }
    await expect(service.complete(created.id, created.uploadToken)).rejects.toMatchObject({ status: 410 })
    expect(r2.status(created.id).status).toBe('disabled')
    expect(r2.objects.has(status.finalKey)).toBe(false)
  })

  it('limits public resolution and protects old published shares without expiresAt', async () => {
    const { r2, service } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.finalKey, bytes)
    r2.putRaw(`shares/${created.id}/status.json`, strToU8(JSON.stringify({ ...status, status: 'ready', uploadVerifier: undefined })))
    await expect(service.resolve(created.id)).resolves.toHaveProperty('url')
    for (let i = 0; i < 60; i++) await service.reserveResolve(source)
    await expect(service.reserveResolve(source)).rejects.toMatchObject({ status: 429 })
  })

  it('logically expires before cleanup and retries deletion failures', async () => {
    const { r2, service, clock } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, bytes)
    const ready = await service.complete(created.id, created.uploadToken)
    clock(ready.expiresAt! + 1)
    await expect(service.resolve(created.id)).rejects.toMatchObject({ status: 410 })
    r2.failDelete = true
    await expect(service.cleanup()).rejects.toThrow('temporary delete failure')
    expect(r2.status(created.id).status).toBe('expired')
    r2.failDelete = false
    await service.cleanup()
    expect(r2.objects.has(status.finalKey)).toBe(false)
    r2.putRaw(status.stagingKey, bytes)
    await service.cleanup()
    expect(r2.objects.has(status.stagingKey)).toBe(false)
  })

  it('does not delete an archive when cleanup races publication', async () => {
    const { r2, service, clock, now } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, bytes)
    const copy = r2.copyCreateOnly.bind(r2)
    r2.copyCreateOnly = async (from, to, etag) => {
      await copy(from, to, etag)
      await service.cleanup()
    }
    const ready = await service.complete(created.id, created.uploadToken)
    expect(r2.objects.has(status.finalKey)).toBe(true)
    await expect(service.resolve(created.id)).resolves.toHaveProperty('url')
    clock(now() + SHARE_MS + 1)
    await service.cleanup()
    expect(r2.objects.has(status.finalKey)).toBe(false)
    expect(ready.status).toBe('ready')
  })

  it('advances a durable cleanup scan past retained early pages', async () => {
    const { r2, service, now } = setup()
    const { status, bytes } = await pending(r2, service)
    const publishedAt = now() - SHARE_MS - 1000
    for (let index = 0; index < 130; index++) {
      const id = index.toString(16).padStart(48, '0')
      const entry = { ...status, id, stagingKey: `staging/${id}/${'a'.repeat(32)}`,
        finalKey: `shares/${id}/archive.board.zip`, status: 'ready',
        createdAt: publishedAt - 1000, publishedAt, expiresAt: publishedAt + SHARE_MS, updatedAt: publishedAt }
      r2.putRaw(`shares/${id}/status.json`, strToU8(JSON.stringify(entry)))
      r2.putRaw(entry.finalKey, bytes)
    }
    const last = `shares/${(129).toString(16).padStart(48, '0')}/archive.board.zip`
    expect(r2.objects.has(last)).toBe(true)
    for (let step = 0; step < 8; step++) await service.cleanupScheduled()
    expect(r2.objects.has(last)).toBe(false)
    const progress = r2.objects.get('trial/cleanup-state-v1.json')
    expect(progress).toBeDefined()
    expect(JSON.parse(new TextDecoder().decode(progress!.bytes)).lastSuccessAt).toBe(now())
  })

  it('reports committed cleanup progress after a concurrent cursor update', async () => {
    const { r2, service, now } = setup()
    const put = r2.putJson.bind(r2)
    r2.putJson = async (key, value, condition) => {
      if (key === 'trial/cleanup-state-v1.json') {
        r2.putRaw(key, strToU8(JSON.stringify({ stagingCursor: 'other-run', lastSuccessAt: now() - 1000 })))
        throw conflict()
      }
      return put(key, value, condition)
    }
    expect(await service.cleanupScheduled()).toEqual({ removed: 0, backlog: true, lastSuccessAt: now() - 1000 })
  })
})
