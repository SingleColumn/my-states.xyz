import { verifyCreatorPassword } from './_lib/creatorAuth.js'
import { readShareConfig, type ShareConfig } from './_lib/shareConfig.js'
import { ShareR2 } from './_lib/shareR2.js'
import { ShareError, ShareService } from './_lib/shareService.js'
import { clearSession, hasCreatorSession, issueSession } from './_lib/shareSession.js'

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, ...(cookie ? { 'Set-Cookie': cookie } : {}) } })
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

export function createBoardSharesHandler(
  configForRequest: () => ShareConfig,
  serviceForConfig: (config: ShareConfig) => ShareService,
) {
  return { async fetch(request: Request): Promise<Response> {
    try {
      const config = configForRequest()
      const action = actionOf(request)
      if (request.method === 'POST' && request.headers.get('origin') !== config.allowedOrigin) {
        return json({ error: 'This request came from an unapproved origin.' }, 403)
      }
      const service = serviceForConfig(config)
      if (request.method === 'POST' && action === 'login') {
        const body = await bodyOf(request)
        if (typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 256) {
          return json({ error: 'Enter a creator passphrase.' }, 400)
        }
        await service.reserveSignInAttempt()
        if (!await verifyCreatorPassword(body.password, config.passwordVerifier)) {
          return json({ error: 'The passphrase was not accepted.' }, 401)
        }
        return json({ ok: true }, 200, issueSession(config.sessionSigningKey))
      }
      if (request.method === 'GET' && action === 'resolve') {
        return json(await service.resolve(idOf(request)))
      }
      const authorized = hasCreatorSession(request.headers.get('cookie'), config.sessionSigningKey)
      if (!authorized) return json({ error: 'Creator sign-in is required.' }, 401)
      if (request.method === 'GET' && action === 'session') return json({ authenticated: true })
      if (request.method === 'POST' && action === 'logout') return json({ ok: true }, 200, clearSession())
      if (request.method === 'GET' && action === 'list') {
        const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined
        const page = await service.list(cursor)
        return json({ ...page, shares: page.shares.map((share) => ({
          ...share, ...(share.status === 'ready' ? { link: `${config.allowedOrigin}/share/${share.id}` } : {}),
        })) })
      }
      if (request.method === 'POST' && action === 'create') {
        const body = await bodyOf(request)
        return json(await service.create(body.byteLength as number, body.sha256 as string), 201)
      }
      if (request.method === 'POST' && action === 'complete') {
        const share = await service.complete(idOf(request))
        return json({ id: share.id, link: `${config.allowedOrigin}/share/${share.id}` })
      }
      if (request.method === 'POST' && action === 'disable') {
        await service.disable(idOf(request))
        return json({ ok: true })
      }
      if (request.method === 'POST' && action === 'cleanup') {
        const body = await bodyOf(request)
        if ((body.stagingCursor !== undefined && typeof body.stagingCursor !== 'string')
          || (body.sharesCursor !== undefined && typeof body.sharesCursor !== 'string')) {
          return json({ error: 'Invalid cleanup cursor.' }, 400)
        }
        return json(await service.cleanup(body.stagingCursor as string | undefined, body.sharesCursor as string | undefined))
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
