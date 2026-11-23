import { decodeSessionSigningKey, validateCreatorPasswordVerifier } from './creatorAuth.js'

export interface ShareConfig {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  passwordVerifier: string
  sessionSigningKey: string
  allowedOrigin: string
}

const names = {
  endpoint: 'BOARD_SHARE_R2_ENDPOINT',
  bucket: 'BOARD_SHARE_R2_BUCKET',
  accessKeyId: 'BOARD_SHARE_R2_ACCESS_KEY_ID',
  secretAccessKey: 'BOARD_SHARE_R2_SECRET_ACCESS_KEY',
  passwordVerifier: 'BOARD_SHARE_CREATOR_PASSWORD_HASH',
  sessionSigningKey: 'BOARD_SHARE_SESSION_SIGNING_KEY',
  allowedOrigin: 'BOARD_SHARE_ALLOWED_ORIGIN',
} as const

export function readShareConfig(env: Record<string, string | undefined>): ShareConfig {
  const result = {} as Record<keyof ShareConfig, string>
  for (const [key, name] of Object.entries(names) as Array<[keyof ShareConfig, string]>) {
    const value = env[name]
    if (!value || !value.trim()) throw new Error(`Board sharing is not configured: ${name} is missing.`)
    result[key] = value
  }
  let endpoint: URL
  let origin: URL
  try {
    endpoint = new URL(result.endpoint)
    origin = new URL(result.allowedOrigin)
  } catch {
    throw new Error('Board sharing has an invalid endpoint or allowed origin.')
  }
  if (
    endpoint.protocol !== 'https:'
    || !/^[a-f0-9]{32}(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)
    || endpoint.pathname !== '/'
    || endpoint.search || endpoint.hash || endpoint.username || endpoint.password
    || origin.protocol !== 'https:'
    || origin.origin !== result.allowedOrigin
    || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password
  ) throw new Error('Board sharing has an invalid endpoint or allowed origin.')
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(result.bucket)) throw new Error('Board sharing has an invalid bucket name.')
  if (result.accessKeyId.length < 10 || result.secretAccessKey.length < 20) throw new Error('Board sharing has invalid R2 credentials.')
  try { validateCreatorPasswordVerifier(result.passwordVerifier) }
  catch { throw new Error('Board sharing has invalid BOARD_SHARE_CREATOR_PASSWORD_HASH format.') }
  try { decodeSessionSigningKey(result.sessionSigningKey) }
  catch { throw new Error('Board sharing has invalid BOARD_SHARE_SESSION_SIGNING_KEY format.') }
  return result as unknown as ShareConfig
}
