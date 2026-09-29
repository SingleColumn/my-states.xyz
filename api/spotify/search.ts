/**
 * GET /api/spotify/search?q=<text>&type=playlist|track
 *
 * Searches Spotify's public catalog with the application's own credentials,
 * so a visitor can browse before connecting their Spotify account. Nothing
 * user-specific is reachable this way, and nothing about the application's
 * credentials is returned.
 *
 * Exported as the default `{ fetch }` object, Vercel's Web Standard handler,
 * which its documentation lists for every framework and for none. Anything
 * but a GET is refused inside serveGet.
 */
import { serveGet, serverDeps } from '../_lib/httpAdapter'
import { handleCatalogSearch } from '../_lib/spotifyCatalog'

export default {
  async fetch(request: Request): Promise<Response> {
    return serveGet(request, (params) => handleCatalogSearch(params, serverDeps()))
  },
}
