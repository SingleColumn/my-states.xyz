/**
 * GET /api/spotify/playlists?ids=<id>,<id>
 *
 * The public display metadata — name, owner, artwork, track count — for the
 * curated playlist ids in src/config/spotifyCuratedPlaylists.ts, so that file
 * only ever has to hold ids. Ids that Spotify will not serve are left out.
 *
 * Exported as the default `{ fetch }` object, Vercel's Web Standard handler,
 * which its documentation lists for every framework and for none. Anything
 * but a GET is refused inside serveGet.
 */
import { serveGet, serverDeps } from '../_lib/httpAdapter'
import { handleCuratedPlaylists } from '../_lib/spotifyCatalog'

export default {
  async fetch(request: Request): Promise<Response> {
    return serveGet(request, (params) => handleCuratedPlaylists(params, serverDeps()))
  },
}
