import { scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createBoardSharesHandler } from '../boardShares'
import { readShareConfig } from './shareConfig'
import { hasCreatorSession, issueSession } from './shareSession'
import { ShareError } from './shareService'
import type { ShareConfig } from './shareConfig'
import type { ShareService } from './shareService'

const origin = 'https://trial.example.test'
const salt = 'ab'.repeat(16)
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const verifier = JSON.stringify({ version: 1, algorithm: 'scrypt', N: 16384, r: 8, p: 1,
  salt, hash: hex(scryptSync('correct passphrase', new Uint8Array(16).fill(0xab), 64, { N: 16384, r: 8, p: 1 })) })
const signingKey = 'cd'.repeat(32)
const config: ShareConfig = { endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, bucket: 'trial-bucket',
  accessKeyId: 'access-key-id', secretAccessKey: 'secret-access-key-long', passwordVerifier: verifier,
  sessionSigningKey: signingKey, allowedOrigin: origin }

const request = (action: string, method = 'POST', cookie?: string, suppliedOrigin = origin, body?: unknown) =>
  new Request(`${origin}/api/boardShares?action=${action}`, { method,
    headers: { Origin: suppliedOrigin, ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

describe('creator configuration and API gates', () => {
  it('rejects missing or malformed configuration without disclosing values', () => {
    const env = {
      BOARD_SHARE_R2_ENDPOINT: config.endpoint, BOARD_SHARE_R2_BUCKET: config.bucket,
      BOARD_SHARE_R2_ACCESS_KEY_ID: config.accessKeyId, BOARD_SHARE_R2_SECRET_ACCESS_KEY: config.secretAccessKey,
      BOARD_SHARE_CREATOR_PASSWORD_HASH: config.passwordVerifier,
      BOARD_SHARE_SESSION_SIGNING_KEY: config.sessionSigningKey, BOARD_SHARE_ALLOWED_ORIGIN: config.allowedOrigin,
    }
    expect(readShareConfig(env).bucket).toBe('trial-bucket')
    expect(() => readShareConfig({ ...env, BOARD_SHARE_SESSION_SIGNING_KEY: 'bad' })).toThrow('BOARD_SHARE_SESSION_SIGNING_KEY format')
    expect(() => readShareConfig({ ...env, BOARD_SHARE_CREATOR_PASSWORD_HASH: '{}' })).toThrow('BOARD_SHARE_CREATOR_PASSWORD_HASH format')
    expect(() => readShareConfig({ ...env, BOARD_SHARE_R2_ENDPOINT: 'http://example.test' })).toThrow('invalid endpoint')
    expect(() => readShareConfig({ ...env, BOARD_SHARE_R2_BUCKET: undefined })).toThrow('BOARD_SHARE_R2_BUCKET is missing')
  })

  it('rejects expired and altered cookies', () => {
    const now = 1_800_000_000_000
    const cookie = issueSession(signingKey, now).split(';')[0]
    expect(hasCreatorSession(cookie, signingKey, now)).toBe(true)
    expect(hasCreatorSession(cookie, signingKey, now + 60 * 60 * 1000)).toBe(false)
    expect(hasCreatorSession(`${cookie.slice(0, -1)}${cookie.endsWith('0') ? '1' : '0'}`, signingKey, now)).toBe(false)
  })

  it('requires origin and session before mutation, and limits sign-in before verification', async () => {
    let attempts = 0
    let created = 0
    const service = {
      async reserveSignInAttempt() { attempts++; if (attempts > 1) throw new ShareError('Too many attempts.', 429) },
      async create() { created++; return { id: 'id' } },
      async resolve() { return { url: 'https://r2.example.test/object', byteLength: 1, sha256: 'a'.repeat(64) } },
    } as unknown as ShareService
    const handler = createBoardSharesHandler(() => config, () => service)
    expect((await handler.fetch(request('create', 'POST', undefined, origin, { byteLength: 1, sha256: 'a'.repeat(64) }))).status).toBe(401)
    expect((await handler.fetch(request('complete'))).status).toBe(401)
    expect((await handler.fetch(request('disable'))).status).toBe(401)
    expect((await handler.fetch(request('login', 'POST', undefined, 'https://other.test', { password: 'correct passphrase' }))).status).toBe(403)
    expect(attempts).toBe(0)
    expect((await handler.fetch(request('login', 'POST', undefined, origin, { password: 'wrong' }))).status).toBe(401)
    const second = await handler.fetch(request('login', 'POST', undefined, origin, { password: 'correct passphrase' }))
    expect(second.status).toBe(429)
    expect(created).toBe(0)
    expect((await handler.fetch(request('resolve', 'GET'))).status).toBe(200)
  })

  it('issues a secure cookie only after valid verification', async () => {
    const service = { async reserveSignInAttempt() {} } as unknown as ShareService
    const handler = createBoardSharesHandler(() => config, () => service)
    const response = await handler.fetch(request('login', 'POST', undefined, origin, { password: 'correct passphrase' }))
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('__Host-board-share-creator=')
    expect(cookie).toContain('Secure; HttpOnly; SameSite=Strict')
    expect(hasCreatorSession(cookie, signingKey)).toBe(true)
  })
})
