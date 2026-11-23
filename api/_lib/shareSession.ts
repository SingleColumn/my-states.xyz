import { signCreatorSession, verifyCreatorSessionSignature } from './creatorAuth.js'

export const COOKIE_NAME = '__Host-board-share-creator'
const SESSION_MS = 60 * 60 * 1000
const sessionPattern = /^v1\.([0-9]{13})\.([a-f0-9]{64})$/

export function issueSession(signingKey: string, now = Date.now()): string {
  const payload = `v1.${now + SESSION_MS}`
  const signature = signCreatorSession(payload, signingKey)
  return `${COOKIE_NAME}=${payload}.${signature}; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Strict`
}

export function clearSession(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`
}

export function hasCreatorSession(cookieHeader: string | null, signingKey: string, now = Date.now()): boolean {
  const token = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1)
  const match = token && sessionPattern.exec(token)
  if (!match) return false
  const expiresAt = Number(match[1])
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + SESSION_MS) return false
  return verifyCreatorSessionSignature(`v1.${match[1]}`, match[2], signingKey)
}
