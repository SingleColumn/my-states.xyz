import { createHmac, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decodeSessionSigningKey, signCreatorSession, verifyCreatorPassword, verifyCreatorSessionSignature } from './creatorAuth'

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
const password = 'a memorable trial phrase 🗝️'
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
const verifier = {
  version: 1,
  algorithm: 'scrypt',
  N: 16384,
  r: 8,
  p: 1,
  salt: hex(salt),
  hash: hex(hash),
}

describe('creator password verification', () => {
  it('accepts the specified JSON verifier and rejects a wrong password', async () => {
    expect(await verifyCreatorPassword(password, JSON.stringify(verifier))).toBe(true)
    expect(await verifyCreatorPassword('a different phrase', JSON.stringify(verifier))).toBe(false)
  })

  it('rejects malformed verifier configuration without exposing it', async () => {
    for (const raw of [
      '{',
      JSON.stringify({ ...verifier, version: 2 }),
      JSON.stringify({ ...verifier, algorithm: 'sha256' }),
      JSON.stringify({ ...verifier, N: 8192 }),
      JSON.stringify({ ...verifier, r: 4 }),
      JSON.stringify({ ...verifier, p: 2 }),
      JSON.stringify({ ...verifier, salt: 'not hex' }),
      JSON.stringify({ ...verifier, salt: 'ab'.repeat(15) }),
      JSON.stringify({ ...verifier, hash: verifier.hash.slice(2) }),
      JSON.stringify({ ...verifier, hash: 'gg'.repeat(64) }),
    ]) {
      await expect(verifyCreatorPassword(password, raw)).rejects.toThrow('Invalid creator password verifier configuration.')
    }
  })
})

describe('creator session signing key', () => {
  it('decodes 32 hex-encoded bytes before HMAC', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index)
    const encoded = hex(bytes)
    expect(decodeSessionSigningKey(encoded)).toEqual(bytes)
    expect(signCreatorSession('session-payload', encoded)).toBe(createHmac('sha256', bytes).update('session-payload').digest('hex'))
    expect(signCreatorSession('session-payload', encoded)).not.toBe(createHmac('sha256', new TextEncoder().encode(encoded)).update('session-payload').digest('hex'))
    const signature = signCreatorSession('session-payload', encoded)
    expect(verifyCreatorSessionSignature('session-payload', signature, encoded)).toBe(true)
    expect(verifyCreatorSessionSignature('changed-payload', signature, encoded)).toBe(false)
    expect(verifyCreatorSessionSignature('session-payload', '0'.repeat(64), encoded)).toBe(false)
    expect(verifyCreatorSessionSignature('session-payload', 'not hex', encoded)).toBe(false)
  })

  it('rejects malformed key configuration', () => {
    for (const key of ['', 'ab'.repeat(31), 'ab'.repeat(33), 'zz'.repeat(32)]) {
      expect(() => decodeSessionSigningKey(key)).toThrow('Invalid creator session signing key configuration.')
      expect(() => signCreatorSession('payload', key)).toThrow('Invalid creator session signing key configuration.')
    }
  })
})
