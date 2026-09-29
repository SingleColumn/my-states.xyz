/**
 * GET /api/spotify/playlists?ids=<id>,<id>
 *
 * The public display metadata — name, owner, artwork, track count — for the
 * curated playlist ids in src/config/spotifyCuratedPlaylists.ts, so that file
 * only ever has to hold ids. Ids that Spotify will not serve are left out.
 */
import { jsonResponse, serverDeps } from '../_lib/httpAdapter'
import { handleCuratedPlaylists } from '../_lib/spotifyCatalog'

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  return jsonResponse(await handleCuratedPlaylists(searchParams, serverDeps()))
}
