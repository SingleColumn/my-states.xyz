import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ShareError, ShareService } from './shareService'
import type { ShareR2 } from './shareR2'

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
  putRaw(key: string, bytes: Uint8Array) {
    this.objects.set(key, { bytes, etag: `"${++this.serial}"` })
  }
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
  async delete(key: string) { this.objects.delete(key) }
  async copyCreateOnly(source: string, destination: string, sourceEtag: string) {
    if (this.objects.has(destination) || this.objects.get(source)?.etag !== sourceEtag) throw conflict()
    this.putRaw(destination, this.objects.get(source)!.bytes)
    this.copied++
  }
  async signedPut(key: string) { return { url: `https://example.test/${key}`, headers: { 'Content-Type': 'application/zip', 'If-None-Match': '*' } } }
  async signedGet(key: string) { return `https://example.test/${key}` }
  async list(prefix: string, cursor?: string, limit = 100) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort()
    const start = cursor ? keys.indexOf(cursor) + 1 : 0
    const page = keys.slice(start, start + limit)
    return { keys: page, ...(start + limit < keys.length ? { cursor: page.at(-1) } : {}) }
  }
  status(id: string) { return JSON.parse(new TextDecoder().decode(this.objects.get(`shares/${id}/status.json`)!.bytes)) }
}

function setup(now = 1000) {
  const r2 = new MemoryR2()
  const service = new ShareService(r2 as unknown as ShareR2, () => now)
  return { r2, service }
}

async function pending(r2: MemoryR2, service: ShareService, bytes = boardZip()) {
  const created = await service.create(bytes.length, digest(bytes))
  const status = r2.status(created.id)
  return { created, status, bytes }
}

describe('R2 share status and completion', () => {
  it('publishes verified bytes once and disables retrieval before deleting the object', async () => {
    const { r2, service } = setup()
    const { created, status, bytes } = await pending(r2, service)
    await expect(service.resolve(created.id)).rejects.toMatchObject({ status: 409 })
    r2.putRaw(status.stagingKey, bytes)
    const first = await service.complete(created.id)
    expect(first.status).toBe('ready')
    expect((await service.complete(created.id)).status).toBe('ready')
    expect(r2.copied).toBe(1)
    expect((await service.resolve(created.id)).sha256).toBe(digest(bytes))
    await service.disable(created.id)
    expect(r2.status(created.id).status).toBe('disabled')
    await expect(service.resolve(created.id)).rejects.toMatchObject({ status: 410 })
    await expect(service.complete(created.id)).rejects.toMatchObject({ status: 410 })
    // A still-valid upload URL can recreate staging, but cannot republish final.
    r2.putRaw(status.stagingKey, bytes)
    await service.cleanup()
    expect(r2.objects.has(status.stagingKey)).toBe(false)
    expect(r2.objects.has(status.finalKey)).toBe(false)
  })

  it('rejects wrong length, digest, malformed ZIP, and expired pending uploads', async () => {
    const { r2, service } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, bytes.slice(1))
    await expect(service.complete(created.id)).rejects.toMatchObject({ status: 422 })
    r2.putRaw(status.stagingKey, new Uint8Array(bytes.length))
    await expect(service.complete(created.id)).rejects.toMatchObject({ status: 422 })
    const corrupt = strToU8('not a zip')
    const other = await pending(r2, service, corrupt)
    r2.putRaw(other.status.stagingKey, corrupt)
    await expect(service.complete(other.created.id)).rejects.toMatchObject({ status: 422 })
    const expired = new ShareService(r2 as unknown as ShareR2, () => status.uploadDeadline + 1)
    await expect(expired.complete(created.id)).rejects.toMatchObject({ status: 410 })
  })

  it('uses compare-and-swap so a disabled share cannot be restored by delayed completion', async () => {
    const { r2, service } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, bytes)
    const original = r2.copyCreateOnly.bind(r2)
    r2.copyCreateOnly = async (source, destination, etag) => {
      await original(source, destination, etag)
      await service.disable(created.id)
    }
    await expect(service.complete(created.id)).rejects.toMatchObject({ status: 410 })
    expect(r2.status(created.id).status).toBe('disabled')
    expect(r2.objects.has(status.finalKey)).toBe(false)
  })

  it('enforces a durable global sign-in attempt budget without IP headers', async () => {
    const { r2, service } = setup()
    for (let i = 0; i < 5; i++) await service.reserveSignInAttempt()
    await expect(service.reserveSignInAttempt()).rejects.toMatchObject({ status: 429 })
    const otherInstance = new ShareService(r2 as unknown as ShareR2, () => 1001)
    await expect(otherInstance.reserveSignInAttempt()).rejects.toMatchObject({ status: 429 })
    const nextWindow = new ShareService(r2 as unknown as ShareR2, () => 1000 + 15 * 60 * 1000)
    await expect(nextWindow.reserveSignInAttempt()).resolves.toBeUndefined()
  })

  it('turns expired pending status into a terminal tombstone during cleanup', async () => {
    const { r2, service } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, bytes)
    const expired = new ShareService(r2 as unknown as ShareR2, () => status.uploadDeadline + 1)
    await expired.cleanup()
    expect(r2.status(created.id).status).toBe('disabled')
    expect(r2.objects.has(status.stagingKey)).toBe(false)
    await expect(expired.complete(created.id)).rejects.toMatchObject({ status: 410 })
  })

  it('removes only disabled entries from the creator list while retaining their tombstones', async () => {
    const { r2, service } = setup()
    const { created, status } = await pending(r2, service)
    await expect(service.dismiss(created.id)).rejects.toMatchObject({ status: 409 })
    await service.disable(created.id)
    expect((await service.list()).shares.map((share) => share.id)).toContain(created.id)
    await Promise.all([service.dismiss(created.id), service.dismiss(created.id)])
    expect((await service.list()).shares.map((share) => share.id)).not.toContain(created.id)
    expect(r2.status(created.id)).toMatchObject({ status: 'disabled', dismissedAt: expect.any(Number) })
    expect(r2.objects.has(`shares/${created.id}/status.json`)).toBe(true)
    await expect(service.resolve(created.id)).rejects.toMatchObject({ status: 410 })
    await expect(service.complete(created.id)).rejects.toMatchObject({ status: 410 })
    await service.cleanup()
    expect(r2.objects.has(`shares/${created.id}/status.json`)).toBe(true)
    expect(r2.objects.has(status.finalKey)).toBe(false)
  })

  it('does not report success if disable wins just after ready publication', async () => {
    const { r2, service } = setup()
    const { created, status, bytes } = await pending(r2, service)
    r2.putRaw(status.stagingKey, bytes)
    const original = r2.delete.bind(r2)
    let disabled = false
    r2.delete = async (key) => {
      await original(key)
      if (key === status.stagingKey && !disabled) { disabled = true; await service.disable(created.id) }
    }
    await expect(service.complete(created.id)).rejects.toMatchObject({ status: 410 })
    expect(r2.status(created.id).status).toBe('disabled')
  })

  it('rejects client-sized input beyond the trial cap and never accepts arbitrary keys', async () => {
    const { service } = setup()
    await expect(service.create(32 * 1024 * 1024 + 1, 'a'.repeat(64))).rejects.toMatchObject({ status: 400 })
    await expect(service.resolve('../../other-key')).rejects.toBeInstanceOf(ShareError)
  })
})
