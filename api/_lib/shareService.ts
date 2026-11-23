import { createHash, randomBytes } from 'node:crypto'
import { MAX_COMPRESSED_BYTES, validateTrialArchive } from './shareArchive.js'
import { isConflict, type ShareR2 } from './shareR2.js'

export const TRIAL_OWNER = 'trial-creator-v1'
export const PENDING_MS = 30 * 60 * 1000
const ID = /^[a-f0-9]{48}$/
const SHA256 = /^[a-f0-9]{64}$/
const STATUS_LIMIT = 4096
const RATE_KEY = 'trial/sign-in-rate.json'
const RATE_WINDOW_MS = 15 * 60 * 1000
const RATE_ATTEMPTS = 5
type R2 = Pick<ShareR2, 'read' | 'head' | 'putJson' | 'delete' | 'copyCreateOnly' | 'signedPut' | 'signedGet' | 'list'>

export class ShareError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export interface ShareStatus {
  schemaVersion: 1
  id: string
  owner: typeof TRIAL_OWNER
  status: 'pending' | 'ready' | 'disabled'
  createdAt: number
  updatedAt: number
  uploadDeadline: number
  stagingKey: string
  finalKey: string
  byteLength: number
  sha256: string
}
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
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
      || !['pending', 'ready', 'disabled'].includes(entry.status)
      || !Number.isSafeInteger(entry.createdAt) || !Number.isSafeInteger(entry.updatedAt)
      || !Number.isSafeInteger(entry.uploadDeadline) || !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength < 1 || entry.byteLength > MAX_COMPRESSED_BYTES || !SHA256.test(entry.sha256)
      || typeof entry.stagingKey !== 'string' || !entry.stagingKey.startsWith(`staging/${id}/`)
      || entry.finalKey !== `shares/${id}/archive.board.zip`) {
      throw new ShareError('Share metadata is invalid.', 503)
    }
    return { value: entry, etag: found.etag }
  }

  /** Global, durable attempt budget: no client-supplied IP address is trusted. */
  async reserveSignInAttempt(): Promise<void> {
    for (let retry = 0; retry < 6; retry++) {
      const found = await this.r2.read(RATE_KEY, 1024)
      let state: { windowStart: number; attempts: number } | null = null
      if (found) {
        try { state = JSON.parse(decode(found.bytes)) } catch { throw new ShareError('Sign-in protection is unavailable.', 503) }
        if (!state || !Number.isSafeInteger(state.windowStart) || !Number.isSafeInteger(state.attempts)) {
          throw new ShareError('Sign-in protection is unavailable.', 503)
        }
      }
      const now = this.now()
      if (state && now - state.windowStart < RATE_WINDOW_MS && state.attempts >= RATE_ATTEMPTS) {
        throw new ShareError('Too many sign-in attempts. Try again later.', 429)
      }
      const next = !state || now - state.windowStart >= RATE_WINDOW_MS
        ? { windowStart: now, attempts: 1 }
        : { windowStart: state.windowStart, attempts: state.attempts + 1 }
      try {
        await this.r2.putJson(RATE_KEY, next, found ? { etag: found.etag } : { none: true })
        return
      } catch (error) { if (!isConflict(error)) throw error }
    }
    throw new ShareError('Sign-in protection is busy. Try again.', 503)
  }

  async create(byteLength: number, sha256: string) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_COMPRESSED_BYTES || !SHA256.test(sha256)) {
      throw new ShareError('The archive size or digest is invalid.', 400)
    }
    for (let retry = 0; retry < 3; retry++) {
      const id = hex(randomBytes(24))
      const now = this.now()
      const value: ShareStatus = {
        schemaVersion: 1, id, owner: TRIAL_OWNER, status: 'pending', createdAt: now, updatedAt: now,
        uploadDeadline: now + PENDING_MS,
        stagingKey: `staging/${id}/${hex(randomBytes(16))}.board.zip`,
        finalKey: `shares/${id}/archive.board.zip`,
        byteLength, sha256,
      }
      try {
        await this.r2.putJson(statusKey(id), value, { none: true })
        return { id, uploadDeadline: value.uploadDeadline, ...await this.r2.signedPut(value.stagingKey) }
      } catch (error) { if (!isConflict(error)) throw error }
    }
    throw new ShareError('Could not allocate a share ID.', 503)
  }

  async complete(id: string): Promise<ShareStatus> {
    const found = await this.readStatus(id)
    if (!found) throw new ShareError('Share not found.', 404)
    const value = found.value
    if (value.status === 'ready') {
      const final = await this.r2.head(value.finalKey)
      if (!final || final.size !== value.byteLength) throw new ShareError('This shared board is temporarily unavailable.', 503)
      return value
    }
    if (value.status === 'disabled') throw new ShareError('This share has been disabled.', 410)
    if (this.now() > value.uploadDeadline) throw new ShareError('The upload window expired. Start a new share.', 410)
    const staged = await this.r2.head(value.stagingKey)
    if (!staged) throw new ShareError('The upload has not arrived yet.', 409)
    if (staged.size !== value.byteLength) throw new ShareError('The uploaded archive has the wrong size.', 422)
    const read = await this.r2.read(value.stagingKey, MAX_COMPRESSED_BYTES)
    if (!read || read.etag !== staged.etag || read.bytes.byteLength !== value.byteLength || digest(read.bytes) !== value.sha256) {
      throw new ShareError('The uploaded archive does not match the prepared board.', 422)
    }
    try { validateTrialArchive(read.bytes) }
    catch (error) { throw new ShareError(error instanceof Error ? error.message : 'The archive is invalid.', 422) }
    try { await this.r2.copyCreateOnly(value.stagingKey, value.finalKey, staged.etag) }
    catch (error) {
      if (!isConflict(error)) throw error
      const final = await this.r2.read(value.finalKey, MAX_COMPRESSED_BYTES)
      if (!final || final.bytes.byteLength !== value.byteLength || digest(final.bytes) !== value.sha256) {
        throw new ShareError('Another completion changed this share. Try again.', 409)
      }
    }
    const ready: ShareStatus = { ...value, status: 'ready', updatedAt: this.now() }
    try { await this.r2.putJson(statusKey(id), ready, { etag: found.etag }) }
    catch (error) {
      if (!isConflict(error)) throw error
      const current = await this.readStatus(id)
      if (current?.value.status === 'ready') return current.value
      if (current?.value.status === 'disabled') {
        await this.r2.delete(value.finalKey)
        throw new ShareError('This share has been disabled.', 410)
      }
      throw new ShareError('Share completion conflicted. Try again.', 409)
    }
    // The PUT URL may still recreate staging. Cleanup also sweeps this prefix.
    await this.r2.delete(value.stagingKey).catch(() => undefined)
    const current = await this.readStatus(id)
    if (current?.value.status !== 'ready') throw new ShareError('This share was disabled during completion.', 410)
    return current.value
  }

  async resolve(id: string) {
    const found = await this.readStatus(id)
    if (!found) throw new ShareError('Share not found.', 404)
    if (found.value.status === 'pending') throw new ShareError('This board is still being prepared.', 409)
    if (found.value.status === 'disabled') throw new ShareError('This share has been disabled.', 410)
    const head = await this.r2.head(found.value.finalKey)
    if (!head || head.size !== found.value.byteLength) throw new ShareError('This shared board is temporarily unavailable.', 503)
    return { url: await this.r2.signedGet(found.value.finalKey), byteLength: found.value.byteLength, sha256: found.value.sha256 }
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

  async list(cursor?: string) {
    const page = await this.r2.list('shares/', cursor, 100)
    const shares: Array<Pick<ShareStatus, 'id' | 'status' | 'createdAt' | 'updatedAt'>> = []
    for (const key of page.keys.filter((candidate) => /^shares\/[a-f0-9]{48}\/status\.json$/.test(candidate))) {
      const id = key.split('/')[1]
      const found = await this.readStatus(id)
      if (found) {
        const { status, createdAt, updatedAt } = found.value
        shares.push({ id, status, createdAt, updatedAt })
      }
    }
    return { shares, cursor: page.cursor }
  }

  /** Bounded, repeatable protected sweep; callers can pass returned cursors. */
  async cleanup(stagingCursor?: string, sharesCursor?: string) {
    const staged = await this.r2.list('staging/', stagingCursor, 100)
    let removed = 0
    for (const key of staged.keys) {
      const id = /^staging\/([a-f0-9]{48})\//.exec(key)?.[1]
      if (!id) continue
      const found = await this.readStatus(id)
      if (!found || found.value.status !== 'pending' || this.now() > found.value.uploadDeadline) {
        await this.r2.delete(key)
        removed++
      }
    }
    const statuses = await this.r2.list('shares/', sharesCursor, 100)
    for (const key of statuses.keys.filter((candidate) => /^shares\/[a-f0-9]{48}\/status\.json$/.test(candidate))) {
      const id = key.split('/')[1]
      const found = await this.readStatus(id)
      if (found?.value.status !== 'pending' || this.now() <= found.value.uploadDeadline) continue
      try {
        await this.r2.putJson(statusKey(id), {
          ...found.value, status: 'disabled', updatedAt: this.now(),
        }, { etag: found.etag })
      } catch (error) {
        if (!isConflict(error)) throw error
        const current = await this.readStatus(id)
        if (current?.value.status !== 'disabled') continue
      }
      await this.r2.delete(found.value.stagingKey)
      await this.r2.delete(found.value.finalKey)
      removed += 2
    }
    for (const key of statuses.keys.filter((candidate) => /^shares\/[a-f0-9]{48}\/archive\.board\.zip$/.test(candidate))) {
      const id = key.split('/')[1]
      const found = await this.readStatus(id)
      if (!found || found.value.status === 'disabled' || (found.value.status === 'pending' && this.now() > found.value.uploadDeadline)) {
        await this.r2.delete(key)
        removed++
      }
    }
    return { removed, stagingCursor: staged.cursor, sharesCursor: statuses.cursor }
  }
}
