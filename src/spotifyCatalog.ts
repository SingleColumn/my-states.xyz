/**
 * The browser's side of anonymous Spotify browsing.
 *
 * It talks to this app's own endpoints, never to Spotify. The application
 * credentials that make those requests possible stay on the server; nothing
 * here holds, receives or could reveal a token of any kind. What comes back
 * is public catalog metadata, already reduced to the same summaries the
 * connected path produces.
 */
import type {
  SpotifyPlaylistSearchResult,
  SpotifyPlaylistSummary,
  SpotifyTrackSearchResult,
} from './spotifyCatalogTypes'

const catalogBasePath = '/api/spotify'

/** A failure someone can be shown: never Spotify's own words, and never a path. */
export class SpotifyCatalogError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SpotifyCatalogError'
    this.status = status
  }
}

export async function searchCatalogPlaylists(query: string, offset = 0): Promise<SpotifyPlaylistSearchResult> {
  const params = new URLSearchParams({ q: query, type: 'playlist' })
  if (offset > 0) params.set('offset', String(offset))
  const result = await requestCatalog<SpotifyPlaylistSearchResult>(`/search?${params.toString()}`)
  return { items: result.items ?? [], hasMore: Boolean(result.hasMore) }
}

export async function searchCatalogTracks(query: string): Promise<SpotifyTrackSearchResult> {
  const params = new URLSearchParams({ q: query, type: 'track' })
  const result = await requestCatalog<SpotifyTrackSearchResult>(`/search?${params.toString()}`)
  return { items: result.items ?? [] }
}

/**
 * The curated suggestions, looked up by id. Ids Spotify will not serve come
 * back missing rather than as an error, so the caller shows what there is.
 */
export async function fetchCuratedPlaylists(ids: string[]): Promise<SpotifyPlaylistSummary[]> {
  if (ids.length === 0) return []
  const result = await requestCatalog<{ items?: SpotifyPlaylistSummary[] }>(`/playlists?ids=${ids.map(encodeURIComponent).join(',')}`)
  return result.items ?? []
}

async function requestCatalog<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${catalogBasePath}${path}`)
  } catch {
    throw new SpotifyCatalogError('Spotify discovery could not be reached.', 0)
  }

  if (!response.ok) {
    // The server already decided what a visitor may be told; anything it did
    // not phrase for one is replaced here rather than shown raw.
    const message = await readCatalogErrorMessage(response)
    throw new SpotifyCatalogError(message ?? 'Spotify discovery is temporarily unavailable.', response.status)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new SpotifyCatalogError('Spotify discovery returned something unreadable.', response.status)
  }
}

async function readCatalogErrorMessage(response: Response) {
  try {
    const json = (await response.json()) as { error?: unknown }
    return typeof json.error === 'string' && json.error.trim() ? json.error : null
  } catch {
    return null
  }
}
