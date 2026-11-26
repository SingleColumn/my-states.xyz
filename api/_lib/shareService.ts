import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { MAX_COMPRESSED_BYTES, validateTrialArchive } from './shareArchive.js'
import { isConflict, type ShareR2 } from './shareR2.js'

export const TRIAL_OWNER = 'trial-creator-v1'
export const PENDING_MS = 30 * 60 * 1000
export const SHARE_MS = 24 * 60 * 60 * 1000
const DAY_MS = SHARE_MS
const SHORT_MS = 15 * 60 * 1000
const RETENTION_MS = 30 * DAY_MS
const ID = /^[a-f0-9]{48}$/
const SHA256 = /^[a-f0-9]{64}$/
const STATUS_LIMIT = 4096
const USAGE_KEY = 'trial/share-usage-v1.json'
const RESOLVE_KEY = 'trial/resolve-usage-v1.json'
const CLEANUP_STATE_KEY = 'trial/cleanup-state-v1.json'
type UsageEntry = { id: string; source: string; at: number; bytes: number; deadline: number; completed?: true }
type ResolveEntry = { source: string; at: number }
type R2 = Pick<ShareR2, 'read' | 'head' | 'putJson' | 'delete' | 'copyCreateOnly' | 'uploadTarget' | 'signedGet' | 'list'>

export class ShareError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export interface ShareStatus {
  schemaVersion: 1
  id: string
  owner: typeof TRIAL_OWNER
  status: 'pending' | 'ready' | 'disabled' | 'expired'
  createdAt: number
  updatedAt: number
  uploadDeadline: number
  stagingKey: string
  finalKey: string
  byteLength: number
  sha256: string
  uploadVerifier?: string
  completionAttempts?: number
  publishedAt?: number
  expiresAt?: number
  dismissedAt?: number
}
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const fromHex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const statusKey = (id: string) => `shares/${id}/status.json`
const safeId = (id: string) => { if (!ID.test(id)) throw new ShareError('Invalid share link.', 400) }
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

export class ShareService {
  constructor(private readonly r2: R2, private readonly now = () => Date.now()) {}

  private async readStatus(id: string): Promise<{ value: ShareStatus; etag: string } | null> {
    safeId(id)
    const found = await this.r2.read(statusKey(id), STATUS_LIMIT)
    if (!found) return null
    let value: unknown
    try { value = JSON.parse(decode(found.bytes)) } catch { throw new ShareError('Share metadata is unreadable.', 503) }
    const entry = value as ShareStatus
    if (!entry || entry.schemaVersion !== 1 || entry.id !== id || entry.owner !== TRIAL_OWNER
      || !['pending', 'ready', 'disabled', 'expired'].includes(entry.status)
      || !Number.isSafeInteger(entry.createdAt) || !Number.isSafeInteger(entry.updatedAt)
      || !Number.isSafeInteger(entry.uploadDeadline) || !Number.isSafeInteger(entry.byteLength)
      || (entry.dismissedAt !== undefined && (entry.status !== 'disabled' || !Number.isSafeInteger(entry.dismissedAt) || entry.dismissedAt < 0))
      || (entry.uploadVerifier !== undefined && !SHA256.test(entry.uploadVerifier))
      || (entry.completionAttempts !== undefined && (!Number.isSafeInteger(entry.completionAttempts) || entry.completionAttempts < 0 || entry.completionAttempts > 5))
      || (entry.publishedAt !== undefined && (!Number.isSafeInteger(entry.publishedAt) || entry.publishedAt < entry.createdAt))
      || (entry.expiresAt !== undefined && (!Number.isSafeInteger(entry.expiresAt) || entry.expiresAt !== (entry.publishedAt ?? 0) + SHARE_MS))
      || entry.byteLength < 1 || entry.byteLength > MAX_COMPRESSED_BYTES || !SHA256.test(entry.sha256)
      || typeof entry.stagingKey !== 'string' || !entry.stagingKey.startsWith(`staging/${id}/`)
      || entry.finalKey !== `shares/${id}/archive.board.zip`) {
      throw new ShareError('Share metadata is invalid.', 503)
    }
    return { value: entry, etag: found.etag }
  }

  private async finalHeadOrRepair(value: ShareStatus) {
    let final = await this.r2.head(value.finalKey)
    if (final?.size === value.byteLength) return final
    // Keep the validated staging object until expiry so an interrupted or
    // externally missing final can be restored without extending the link.
    const staged = await this.r2.read(value.stagingKey, MAX_COMPRESSED_BYTES)
    if (!staged || staged.bytes.byteLength !== value.byteLength || digest(staged.bytes) !== value.sha256) {
      throw new ShareError('This shared board is temporarily unavailable.', 503)
    }
    try { await this.r2.copyCreateOnly(value.stagingKey, value.finalKey, staged.etag) }
    catch (error) { if (!isConflict(error)) throw error }
    final = await this.r2.head(value.finalKey)
    if (!final || final.size !== value.byteLength) throw new ShareError('This shared board is temporarily unavailable.', 503)
    return final
  }

  private async readEntries<T>(key: string, valid: (entry: T) => boolean): Promise<{ entries: T[]; etag?: string }> {
    const found = await this.r2.read(key, 256 * 1024)
    if (!found) return { entries: [] }
    let entries: unknown
    try { entries = JSON.parse(decode(found.bytes)) } catch { throw new ShareError('Sharing limits are unavailable.', 503) }
    if (!Array.isArray(entries) || !entries.every((entry) => valid(entry as T))) throw new ShareError('Sharing limits are unavailable.', 503)
    return { entries: entries as T[], etag: found.etag }
  }

  private async reserveCreate(id: string, source: string, bytes: number, deadline: number): Promise<void> {
    for (let retry = 0; retry < 32; retry++) {
      const found = await this.readEntries<UsageEntry>(USAGE_KEY, (entry) =>
        typeof entry.id === 'string' && ID.test(entry.id) && SHA256.test(entry.source)
        && Number.isSafeInteger(entry.at) && Number.isSafeInteger(entry.bytes)
        && Number.isSafeInteger(entry.deadline) && (entry.completed === undefined || entry.completed === true))
      const now = this.now()
      const entries = found.entries.filter((entry) => entry.at > now - DAY_MS)
      const bySource = entries.filter((entry) => entry.source === source)
      const pending = entries.filter((entry) => !entry.completed && entry.deadline > now)
      const activeBytes = entries.filter((entry) => entry.completed || entry.deadline > now).reduce((sum, entry) => sum + entry.bytes, 0)
      const retryAt = Math.min(...bySource.filter((entry) => entry.at > now - SHORT_MS).map((entry) => entry.at + SHORT_MS), now + SHORT_MS)
      if (bySource.filter((entry) => entry.at > now - SHORT_MS).length >= 4)
        throw new ShareError(`Too many shares from this connection. Try again after ${new Date(retryAt).toISOString()}.`, 429)
      if (bySource.length >= 12 || entries.length >= 100) {
        const first = Math.min(...(bySource.length >= 12 ? bySource : entries).map((entry) => entry.at))
        throw new ShareError(`The daily sharing limit has been reached. Try again after ${new Date(first + DAY_MS).toISOString()}.`, 429)
      }
      if (pending.filter((entry) => entry.source === source).length >= 4 || pending.length >= 20)
        throw new ShareError('Too many uploads are in progress. Try again in about 30 minutes.', 429)
      if (activeBytes + bytes > 512 * 1024 * 1024)
        throw new ShareError('The daily sharing capacity is full. Try again later.', 429)
      try {
        await this.r2.putJson(USAGE_KEY, [...entries, { id, source, at: now, bytes, deadline }],
          found.etag ? { etag: found.etag } : { none: true })
        return
      } catch (error) { if (!isConflict(error)) throw error }
    }
    throw new ShareError('Sharing is busy. Try again shortly.', 503)
  }

  private async markCompleted(id: string): Promise<void> {
    for (let retry = 0; retry < 10; retry++) {
      const found = await this.readEntries<UsageEntry>(USAGE_KEY, (entry) =>
        typeof entry.id === 'string' && ID.test(entry.id) && SHA256.test(entry.source)
        && Number.isSafeInteger(entry.at) && Number.isSafeInteger(entry.bytes)
        && Number.isSafeInteger(entry.deadline) && (entry.completed === undefined || entry.completed === true))
      const entry = found.entries.find((item) => item.id === id)
      if (!entry || entry.completed) return
      try {
        await this.r2.putJson(USAGE_KEY, found.entries.map((item) => item.id === id ? { ...item, completed: true } : item), { etag: found.etag })
        return
      } catch (error) { if (!isConflict(error)) throw error }
    }
    // A conservative pending reservation remains until its deadline if the ledger is busy.
  }

  async reserveResolve(source: string): Promise<void> {
    for (let retry = 0; retry < 10; retry++) {
      const found = await this.readEntries<ResolveEntry>(RESOLVE_KEY, (entry) =>
        SHA256.test(entry.source) && Number.isSafeInteger(entry.at))
      const now = this.now()
      const entries = found.entries.filter((entry) => entry.at > now - SHORT_MS)
      if (entries.length >= 1000 || entries.filter((entry) => entry.source === source).length >= 60)
        throw new ShareError('Too many links opened from this connection. Try again in 15 minutes.', 429)
      try {
        await this.r2.putJson(RESOLVE_KEY, [...entries, { source, at: now }], found.etag ? { etag: found.etag } : { none: true })
        return
      } catch (error) { if (!isConflict(error)) throw error }
    }
    throw new ShareError('Sharing is busy. Try again shortly.', 503)
  }

  async create(byteLength: number, sha256: string, source: string) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_COMPRESSED_BYTES || !SHA256.test(sha256)) {
      throw new ShareError('The archive size or digest is invalid.', 400)
    }
    if (!SHA256.test(source)) throw new ShareError('Sharing source is unavailable.', 503)
    const id = hex(randomBytes(24))
    const uploadToken = hex(randomBytes(32))
    const now = this.now()
    const value: ShareStatus = {
      schemaVersion: 1, id, owner: TRIAL_OWNER, status: 'pending', createdAt: now, updatedAt: now,
      uploadDeadline: now + PENDING_MS,
      stagingKey: `staging/${id}/${hex(randomBytes(16))}.board.zip`,
      finalKey: `shares/${id}/archive.board.zip`,
      byteLength, sha256, uploadVerifier: digest(new TextEncoder().encode(uploadToken)),
    }
    await this.reserveCreate(id, source, byteLength, value.uploadDeadline)
    try { await this.r2.putJson(statusKey(id), value, { none: true }) }
    catch (error) {
      if (isConflict(error)) throw new ShareError('Could not allocate a share ID. Try again.', 503)
      throw error
    }
    return { id, uploadToken, uploadDeadline: value.uploadDeadline, ...await this.r2.uploadTarget(value.stagingKey, id, uploadToken) }
  }

  async complete(id: string, uploadToken: string): Promise<ShareStatus> {
    let found = await this.readStatus(id)
    if (!found) throw new ShareError('Share not found.', 404)
    let value = found.value
    if (!value.uploadVerifier || !/^[a-f0-9]{64}$/.test(uploadToken)
      || !timingSafeEqual(fromHex(value.uploadVerifier), fromHex(digest(new TextEncoder().encode(uploadToken))))) {
      throw new ShareError('Upload authorization was not accepted.', 403)
    }
    if (value.status === 'ready') {
      if (value.expiresAt !== undefined && this.now() >= value.expiresAt) throw new ShareError('This share has expired.', 410)
      await this.finalHeadOrRepair(value)
      await this.markCompleted(id).catch(() => undefined)
      return value
    }
    if (value.status === 'disabled' || value.status === 'expired') throw new ShareError('This share is no longer available.', 410)
    if (this.now() > value.uploadDeadline) throw new ShareError('The upload window expired. Start a new share.', 410)
    // Each valid-token attempt is reserved before expensive download and ZIP validation.
    for (let retry = 0; retry < 10; retry++) {
      if ((value.completionAttempts ?? 0) >= 5) throw new ShareError('This upload could not be confirmed. Start a new share.', 429)
      try {
        await this.r2.putJson(statusKey(id), { ...value, completionAttempts: (value.completionAttempts ?? 0) + 1 }, { etag: found.etag })
        found = await this.readStatus(id)
        if (!found) throw new ShareError('Share not found.', 404)
        value = found.value
        break
      } catch (error) {
        if (!isConflict(error)) throw error
        found = await this.readStatus(id)
        if (!found) throw new ShareError('Share not found.', 404)
        value = found.value
        if (value.status === 'ready') {
          if (value.expiresAt !== undefined && this.now() >= value.expiresAt) throw new ShareError('This share has expired.', 410)
          return value
        }
        if (value.status !== 'pending') throw new ShareError('This share is no longer available.', 410)
        if (retry === 9) throw new ShareError('Share confirmation is busy. Try again.', 503)
      }
    }
    if (value.status !== 'pending') throw new ShareError('This share is no longer available.', 410)
    const staged = await this.r2.head(value.stagingKey)
    if (!staged) throw new ShareError('The upload has not arrived yet.', 409)
    if (staged.size !== value.byteLength) throw new ShareError('The uploaded archive has the wrong size.', 422)
    const read = await this.r2.read(value.stagingKey, MAX_COMPRESSED_BYTES)
    if (!read || read.etag !== staged.etag || read.bytes.byteLength !== value.byteLength || digest(read.bytes) !== value.sha256) {
      throw new ShareError('The uploaded archive does not match the prepared board.', 422)
    }
    try { validateTrialArchive(read.bytes) }
    catch (error) { throw new ShareError(error instanceof Error ? error.message : 'The archive is invalid.', 422) }
    if (this.now() > value.uploadDeadline) throw new ShareError('The upload window expired. Start a new share.', 410)
    try { await this.r2.copyCreateOnly(value.stagingKey, value.finalKey, staged.etag) }
    catch (error) {
      if (!isConflict(error)) throw error
      const final = await this.r2.read(value.finalKey, MAX_COMPRESSED_BYTES)
      if (!final || final.bytes.byteLength !== value.byteLength || digest(final.bytes) !== value.sha256) {
        throw new ShareError('Another completion changed this share. Try again.', 409)
      }
    }
    const publishedAt = this.now()
    if (publishedAt > value.uploadDeadline) {
      throw new ShareError('The upload window expired. Start a new share.', 410)
    }
    const ready: ShareStatus = { ...value, status: 'ready', updatedAt: publishedAt, publishedAt, expiresAt: publishedAt + SHARE_MS }
    try { await this.r2.putJson(statusKey(id), ready, { etag: found.etag }) }
    catch (error) {
      if (!isConflict(error)) throw error
      const current = await this.readStatus(id)
      if (current?.value.status === 'ready') {
        if (current.value.expiresAt !== undefined && this.now() >= current.value.expiresAt) throw new ShareError('This share has expired.', 410)
        await this.markCompleted(id).catch(() => undefined); return current.value
      }
      if (current?.value.status === 'disabled' || current?.value.status === 'expired') {
        await this.r2.delete(value.finalKey)
        throw new ShareError('This share has been disabled.', 410)
      }
      throw new ShareError('Share completion conflicted. Try again.', 409)
    }
    // Retain staging until expiry for repair and to keep old create-only PUTs
    // from recreating the key while their authorization remains valid.
    const current = await this.readStatus(id)
    if (current?.value.status !== 'ready') throw new ShareError('This share was disabled during completion.', 410)
    await this.markCompleted(id).catch(() => undefined)
    return current.value
  }

  async resolve(id: string) {
    const found = await this.readStatus(id)
    if (!found) throw new ShareError('Share not found.', 404)
    if (found.value.status === 'pending') throw new ShareError('This board is still being prepared.', 409)
    if (found.value.status === 'disabled') throw new ShareError('This share has been disabled.', 410)
    if (found.value.status === 'expired' || (found.value.expiresAt !== undefined && this.now() >= found.value.expiresAt))
      throw new ShareError('This share has expired.', 410)
    await this.finalHeadOrRepair(found.value)
    // Signing time is rounded to whole seconds; leave five seconds of margin.
    const now = this.now()
    const seconds = found.value.expiresAt === undefined ? 120
      : Math.min(120, Math.floor((found.value.expiresAt - (now - now % 1000)) / 1000) - 5)
    if (seconds < 1) throw new ShareError('This share has expired.', 410)
    return { url: await this.r2.signedGet(found.value.finalKey, seconds), byteLength: found.value.byteLength, sha256: found.value.sha256 }
  }

  async disable(id: string): Promise<void> {
    const found = await this.readStatus(id)
    if (!found) throw new ShareError('Share not found.', 404)
    const value = found.value
    if (value.status !== 'disabled') {
      try {
        await this.r2.putJson(statusKey(id), { ...value, status: 'disabled', updatedAt: this.now() }, { etag: found.etag })
      } catch (error) {
        if (!isConflict(error)) throw error
        const current = await this.readStatus(id)
        if (current?.value.status !== 'disabled') throw new ShareError('Share changed. Retry disabling it.', 409)
      }
    }
    await this.r2.delete(value.finalKey)
    await this.r2.delete(value.stagingKey)
  }

  /** Bounded, repeatable protected sweep; callers can pass returned cursors. */
  async cleanup(stagingCursor?: string, sharesCursor?: string) {
    const staged = await this.r2.list('staging/', stagingCursor, 100)
    let removed = 0
    const statuses = await this.r2.list('shares/', sharesCursor, 100)
    for (const key of statuses.keys.filter((candidate) => /^shares\/[a-f0-9]{48}\/status\.json$/.test(candidate))) {
      const id = key.split('/')[1]
      const found = await this.readStatus(id)
      if (!found) continue
      const value = found.value
      const expiredPending = value.status === 'pending' && this.now() > value.uploadDeadline
      const expiredReady = value.status === 'ready' && value.expiresAt !== undefined && this.now() >= value.expiresAt
      if (value.status === 'disabled' || value.status === 'expired') {
        await this.r2.delete(value.stagingKey)
        await this.r2.delete(value.finalKey)
        removed += 2
        if (this.now() - value.updatedAt >= RETENTION_MS) { await this.r2.delete(key); removed++ }
        continue
      }
      if (!expiredPending && !expiredReady) continue
      try {
        await this.r2.putJson(statusKey(id), {
          ...value, status: 'expired', updatedAt: this.now(),
        }, { etag: found.etag })
      } catch (error) {
        if (!isConflict(error)) throw error
        const current = await this.readStatus(id)
        if (current?.value.status !== 'expired' && current?.value.status !== 'disabled') continue
      }
      await this.r2.delete(value.stagingKey)
      await this.r2.delete(value.finalKey)
      removed += 2
    }
    for (const key of staged.keys) {
      const id = /^staging\/([a-f0-9]{48})\//.exec(key)?.[1]
      if (!id) continue
      const found = await this.readStatus(id)
      if (!found || found.value.status === 'disabled' || found.value.status === 'expired'
        || (found.value.status === 'ready' && found.value.expiresAt !== undefined && this.now() >= found.value.expiresAt)) {
        await this.r2.delete(key)
        removed++
      }
    }
    for (const key of statuses.keys.filter((candidate) => /^shares\/[a-f0-9]{48}\/archive\.board\.zip$/.test(candidate))) {
      const id = key.split('/')[1]
      const found = await this.readStatus(id)
      if (!found || found.value.status === 'disabled' || found.value.status === 'expired'
        || (found.value.status === 'ready' && found.value.expiresAt !== undefined && this.now() >= found.value.expiresAt)) {
        await this.r2.delete(key)
        removed++
      }
    }
    return { removed, stagingCursor: staged.cursor, sharesCursor: statuses.cursor }
  }

  /** One bounded page per invocation; CAS state advances only after all work succeeds. */
  async cleanupScheduled() {
    const found = await this.r2.read(CLEANUP_STATE_KEY, 4096)
    let state: { stagingCursor?: string; sharesCursor?: string; lastSuccessAt?: number } = {}
    if (found) {
      try { state = JSON.parse(decode(found.bytes)) }
      catch { throw new ShareError('Cleanup progress is unreadable.', 503) }
      if (!state || typeof state !== 'object'
        || (state.stagingCursor !== undefined && typeof state.stagingCursor !== 'string')
        || (state.sharesCursor !== undefined && typeof state.sharesCursor !== 'string')) {
        throw new ShareError('Cleanup progress is invalid.', 503)
      }
    }
    const result = await this.cleanup(state.stagingCursor, state.sharesCursor)
    const next = { stagingCursor: result.stagingCursor, sharesCursor: result.sharesCursor,
      lastSuccessAt: this.now() }
    try { await this.r2.putJson(CLEANUP_STATE_KEY, next, found ? { etag: found.etag } : { none: true }) }
    catch (error) { if (!isConflict(error)) throw error } // another run will continue from its committed cursor
    return { removed: result.removed, backlog: !!(result.stagingCursor || result.sharesCursor), lastSuccessAt: next.lastSuccessAt }
  }
}
