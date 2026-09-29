/**
 * The join between a handler's plain `{ status, body, headers }` answer and
 * whatever is asking for it: a Vercel function, or the Vite dev server.
 */
import type { CatalogDeps, HandlerResult } from './spotifyCatalog'

export function jsonResponse(result: HandlerResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...result.headers },
  })
}

/** The deployment's own environment and fetch: the only place they are read. */
export function serverDeps(): CatalogDeps {
  return { env: process.env, fetch: globalThis.fetch }
}

/**
 * Answers a request the way every function here should: GET and nothing else.
 *
 * The functions are exported as `{ fetch }`, Vercel's Web Standard handler,
 * which is handed every HTTP method. These endpoints only ever read, so
 * anything but a GET is refused here rather than reaching the catalog code —
 * and the refusal names what is allowed, as a well-behaved 405 does.
 */
export async function serveGet(
  request: Request,
  run: (params: URLSearchParams) => Promise<HandlerResult>,
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({
      status: 405,
      body: { error: 'This endpoint only answers GET requests.' },
      headers: { Allow: 'GET' },
    })
  }
  const { searchParams } = new URL(request.url)
  return jsonResponse(await run(searchParams))
}
