import { createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { decodeSessionSigningKey } from './_lib/creatorAuth.js'
import { readShareConfig, type ShareConfig } from './_lib/shareConfig.js'
import { ShareR2 } from './_lib/shareR2.js'
import { ShareError, ShareService } from './_lib/shareService.js'

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const actionOf = (request: Request) => new URL(request.url).searchParams.get('action')
const idOf = (request: Request) => new URL(request.url).searchParams.get('id') ?? ''

async function bodyOf(request: Request, fields: readonly string[], optional: readonly string[] = []): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) {
    throw new ShareError('JSON Content-Type is required.', 415)
  }
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 2048)) {
    throw new ShareError('Request is too large.', 413)
  }
  if (!request.body) throw new ShareError('Invalid request body.', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 2048) {
        await reader.cancel().catch(() => undefined)
        throw new ShareError('Request is too large.', 413)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) }
  catch { throw new ShareError('Invalid request body.', 400) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ShareError('Invalid request body.', 400)
  if (Object.keys(value).some((key) => !fields.includes(key) && !optional.includes(key)) || fields.some((key) => !(key in value))) {
    throw new ShareError('Invalid request fields.', 400)
  }
  return value as Record<string, unknown>
}

// Vercel overwrites X-Forwarded-For at its ingress. Never use a browser-supplied
// address on a non-Vercel deployment as a durable rate-limit identity.
function platformAddress(request: Request): string | null {
  if (process.env.VERCEL !== '1') return null
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return address && isIP(address) ? address : null
}

function sourceKey(config: ShareConfig, address: string | null): string {
  if (!address) throw new ShareError('Sharing is temporarily unavailable. Try again later.', 503)
  return createHmac('sha256', decodeSessionSigningKey(config.sessionSigningKey)).update(address).digest('hex')
}

function hasOperationsKey(request: Request, config: ShareConfig): boolean {
  const authorization = request.headers.get('authorization')
  if (!authorization || !/^Bearer [a-f0-9]{64}$/.test(authorization)) return false
  const provided = Uint8Array.from(authorization.slice(7).match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
  return timingSafeEqual(provided, decodeSessionSigningKey(config.sessionSigningKey))
}

export function createBoardSharesHandler(
  configForRequest: () => ShareConfig,
  serviceForConfig: (config: ShareConfig) => ShareService,
  addressOf: (request: Request) => string | null = platformAddress,
) {
  return { async fetch(request: Request): Promise<Response> {
    try {
      const config = configForRequest()
      const url = new URL(request.url)
      const action = actionOf(request)
      if ([...url.searchParams.keys()].some((key) => key !== 'action' && key !== 'id')
        || url.searchParams.getAll('action').length !== 1 || url.searchParams.getAll('id').length > 1) {
        return json({ error: 'Invalid request parameters.' }, 400)
      }
      if ((action === 'create' || action === 'cleanup') && url.searchParams.has('id')) {
        return json({ error: 'Invalid request parameters.' }, 400)
      }
      if ((action === 'complete' || action === 'resolve' || action === 'disable') && !url.searchParams.has('id')) {
        return json({ error: 'Invalid request parameters.' }, 400)
      }
      const service = serviceForConfig(config)
      if (request.method === 'GET' && action === 'resolve') {
        await service.reserveResolve(sourceKey(config, addressOf(request)))
        return json(await service.resolve(idOf(request)))
      }
      if (request.method === 'POST' && (action === 'cleanup' || action === 'disable')) {
        if (!hasOperationsKey(request, config)) return json({ error: 'Operational authorization is required.' }, 401)
        if (action === 'disable') {
          if (request.body) return json({ error: 'Unexpected request body.' }, 400)
          await service.disable(idOf(request)); return json({ ok: true })
        }
        // Vercel path schedules send an empty POST without Content-Type.
        if (!request.headers.has('content-type') && (!request.body || request.headers.get('content-length') === '0')) {
          return json(await service.cleanupScheduled())
        }
        const body = await bodyOf(request, [], ['stagingCursor', 'sharesCursor'])
        if ((body.stagingCursor !== undefined && typeof body.stagingCursor !== 'string')
          || (body.sharesCursor !== undefined && typeof body.sharesCursor !== 'string')) {
          return json({ error: 'Invalid cleanup cursor.' }, 400)
        }
        return json(await service.cleanup(body.stagingCursor as string | undefined, body.sharesCursor as string | undefined))
      }
      if (request.method === 'POST' && (action === 'create' || action === 'complete')) {
        if (request.headers.get('origin') !== config.allowedOrigin)
          return json({ error: 'This request came from an unapproved origin.' }, 403)
        const body = await bodyOf(request, action === 'create' ? ['byteLength', 'sha256'] : ['uploadToken'])
        if (action === 'create') {
          return json(await service.create(body.byteLength as number, body.sha256 as string,
            sourceKey(config, addressOf(request))), 201)
        }
        const share = await service.complete(idOf(request), body.uploadToken as string)
        return json({ id: share.id, link: `${config.allowedOrigin}/share/${share.id}`, expiresAt: share.expiresAt ?? null })
      }
      return json({ error: 'Unknown board-sharing request.' }, 404)
    } catch (error) {
      if (error instanceof ShareError) return json({ error: error.message }, error.status)
      if (error instanceof Error && error.message.startsWith('Board sharing')) return json({ error: error.message }, 503)
      return json({ error: 'Board sharing is temporarily unavailable.' }, 503)
    }
  } }
}

export default createBoardSharesHandler(
  () => readShareConfig(process.env),
  (config) => new ShareService(new ShareR2(config)),
)
