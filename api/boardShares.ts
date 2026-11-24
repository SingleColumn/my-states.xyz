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

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length'))
  if (Number.isFinite(length) && length > 2048) throw new ShareError('Request is too large.', 413)
  const text = await request.text()
  if (text.length > 2048) throw new ShareError('Request is too large.', 413)
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new ShareError('Invalid request body.', 400) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ShareError('Invalid request body.', 400)
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
      const action = actionOf(request)
      const service = serviceForConfig(config)
      if (request.method === 'GET' && action === 'resolve') {
        await service.reserveResolve(sourceKey(config, addressOf(request)))
        return json(await service.resolve(idOf(request)))
      }
      if (request.method === 'POST' && (action === 'cleanup' || action === 'disable')) {
        if (!hasOperationsKey(request, config)) return json({ error: 'Operational authorization is required.' }, 401)
        if (action === 'disable') { await service.disable(idOf(request)); return json({ ok: true }) }
        const body = await bodyOf(request)
        if ((body.stagingCursor !== undefined && typeof body.stagingCursor !== 'string')
          || (body.sharesCursor !== undefined && typeof body.sharesCursor !== 'string')) {
          return json({ error: 'Invalid cleanup cursor.' }, 400)
        }
        return json(await service.cleanup(body.stagingCursor as string | undefined, body.sharesCursor as string | undefined))
      }
      if (request.method === 'POST' && (action === 'create' || action === 'complete')) {
        if (request.headers.get('origin') !== config.allowedOrigin)
          return json({ error: 'This request came from an unapproved origin.' }, 403)
        const body = await bodyOf(request)
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
