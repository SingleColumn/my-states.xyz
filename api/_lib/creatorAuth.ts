import { createHmac, scrypt, timingSafeEqual } from 'node:crypto'

const HASH_BYTES = 64
const SIGNING_KEY_BYTES = 32
const HEX = /^(?:[0-9a-fA-F]{2})+$/

interface PasswordVerifier {
  version: 1
  algorithm: 'scrypt'
  N: 16384
  r: 8
  p: 1
  salt: string
  hash: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hexBytes(value: unknown, expectedBytes?: number): Uint8Array | null {
  if (typeof value !== 'string' || !HEX.test(value) || (expectedBytes !== undefined && value.length !== expectedBytes * 2)) return null
  const bytes = new Uint8Array(value.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function readVerifier(raw: string): { salt: Uint8Array; hash: Uint8Array } {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('Invalid creator password verifier configuration.') }
  if (
    !isRecord(value)
    || value.version !== 1
    || value.algorithm !== 'scrypt'
    || value.N !== 16384
    || value.r !== 8
    || value.p !== 1
  ) throw new Error('Invalid creator password verifier configuration.')
  const salt = hexBytes(value.salt, 16)
  const hash = hexBytes(value.hash, HASH_BYTES)
  if (!salt || !hash) throw new Error('Invalid creator password verifier configuration.')
  return { salt, hash }
}

export function validateCreatorPasswordVerifier(verifierJson: string): void {
  readVerifier(verifierJson)
}

/** Invalid configuration is an error; a well-formed verifier with the wrong password returns false. */
export async function verifyCreatorPassword(password: string, verifierJson: string): Promise<boolean> {
  const { salt, hash } = readVerifier(verifierJson)
  const derived = await new Promise<Uint8Array>((resolve, reject) => {
    scrypt(password, salt, HASH_BYTES, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
  return timingSafeEqual(derived, hash)
}

export function decodeSessionSigningKey(hex: string): Uint8Array {
  const key = hexBytes(hex, SIGNING_KEY_BYTES)
  if (!key) throw new Error('Invalid creator session signing key configuration.')
  return key
}

/** The signing key is decoded from its configured hex representation before HMAC sees it. */
export function signCreatorSession(payload: string, signingKeyHex: string): string {
  const key = decodeSessionSigningKey(signingKeyHex)
  return createHmac('sha256', key).update(payload).digest('hex')
}

export function verifyCreatorSessionSignature(payload: string, signatureHex: string, signingKeyHex: string): boolean {
  const key = decodeSessionSigningKey(signingKeyHex)
  const expected = createHmac('sha256', key).update(payload).digest('hex')
  const supplied = hexBytes(signatureHex, 32)
  const expectedBytes = hexBytes(expected, 32)!
  return supplied !== null && timingSafeEqual(supplied, expectedBytes)
}
