/**
 * GET /api/spotify/search?q=<text>&type=playlist|track
 *
 * Searches Spotify's public catalog with the application's own credentials,
 * so a visitor can browse before connecting their Spotify account. Nothing
 * user-specific is reachable this way, and nothing about the application's
 * credentials is returned.
 */
import { jsonResponse, serverDeps } from '../_lib/httpAdapter'
import { handleCatalogSearch } from '../_lib/spotifyCatalog'

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  return jsonResponse(await handleCatalogSearch(searchParams, serverDeps()))
}
