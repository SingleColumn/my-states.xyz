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
