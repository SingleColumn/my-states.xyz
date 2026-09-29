/**
 * The whole of the server's Spotify surface: a search over the public
 * catalog, and a lookup of the curated playlists by id.
 *
 * This is deliberately not a proxy. The client cannot name a Spotify path, a
 * Spotify URL, or a Spotify method; it can ask these two questions and no
 * others, with every parameter validated and capped here. A general proxy
 * would hand anyone on the internet the application's credentials to use as
 * they liked, which is the one thing this endpoint exists to prevent.
 *
 * The handlers return a plain `{ status, body, headers }` so the same code
 * answers a Vercel function, the Vite dev server, and a test.
 */
import {
  isSpotifyPlaylistApiItem,
  isSpotifyTrackApiItem,
  mapPlaylist,
  mapTrack,
  type SpotifyPlaylistApiItem,
  type SpotifyPlaylistSearchResult,
  type SpotifyTrackApiItem,
  type SpotifyTrackSearchResult,
} from '../../src/spotifyCatalogTypes'
import {
  getSpotifyAppToken,
  invalidateAppToken,
  readRetryAfter,
  readSpotifyServerCredentials,
  SpotifyConfigurationError,
  SpotifyUpstreamError,
  type AppTokenDeps,
} from './spotifyAppToken'

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'

/** What the visitor is told when the server cannot ask Spotify anything. */
export const discoveryUnavailableMessage = 'Spotify discovery is temporarily unavailable.'

export const catalogSearchTypes = ['playlist', 'track'] as const
export type CatalogSearchType = (typeof catalogSearchTypes)[number]

/** Two characters is where an answer starts to mean something; the panel agrees. */
export const minQueryLength = 2
/**
 * Longer than any search anyone types — including the `track:… artist:…`
 * form the panel builds for a "song - artist" search — and short enough that
 * nobody can use this endpoint to post data through.
 */
export const maxQueryLength = 200
/**
 * Spotify's search endpoint documents a limit range of 0-10 and answers 400
 * above it, whatever older documentation said. Ten is therefore both our cap
 * and the most a page can hold.
 */
export const maxSearchLimit = 10
export const maxSearchOffset = 1000
/** The suggestion area shows about six; a dozen leaves room to ask for a few spares. */
export const maxPlaylistIds = 12

export interface HandlerResult {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface CatalogDeps {
  env: Record<string, string | undefined>
  fetch: typeof globalThis.fetch
  now?: () => number
}

class ValidationError extends Error {}

/** GET /api/spotify/search?q=...&type=playlist|track[&offset=] */
export async function handleCatalogSearch(params: URLSearchParams, deps: CatalogDeps): Promise<HandlerResult> {
  let query: string
  let type: CatalogSearchType
  let limit: number
  let offset: number
  try {
    query = readQuery(params)
    type = readSearchType(params)
    limit = readBoundedInteger(params.get('limit'), 1, maxSearchLimit, maxSearchLimit, 'limit')
    offset = readBoundedInteger(params.get('offset'), 0, maxSearchOffset, 0, 'offset')
  } catch (caught) {
    return badRequest(caught)
  }

  const search = new URLSearchParams({ q: query, type, limit: String(limit), offset: String(offset) })
  return respond(async () => {
    const page = await spotifyAppFetch<SpotifySearchPage>(`/search?${search.toString()}`, deps)
    if (type === 'track') {
      const items = (page.tracks?.items ?? []).filter(isSpotifyTrackApiItem).map(mapTrack)
      return { status: 200, body: { items } satisfies SpotifyTrackSearchResult, headers: cacheFor(60) }
    }
    const items = (page.playlists?.items ?? []).filter(isSpotifyPlaylistApiItem).map(mapPlaylist)
    const result: SpotifyPlaylistSearchResult = { items, hasMore: Boolean(page.playlists?.next) }
    return { status: 200, body: result, headers: cacheFor(60) }
  })
}

/**
 * GET /api/spotify/playlists?ids=a,b,c — the display metadata for curated
 * suggestions, looked up from their ids so the source file holds ids alone.
 *
 * A playlist Spotify will not describe is left out rather than failing the
 * lot: one id that has been deleted, made private, or is one of the
 * Spotify-owned editorial playlists the Web API no longer serves must not
 * empty the whole suggestion area.
 *
 * That is all that is left out. Anything else that goes wrong — no
 * credentials, a token Spotify refuses, a rate limit, Spotify being down — is
 * about this deployment or about every playlist at once, and answering "no
 * playlists" with a 200 would make a broken deployment look like an empty
 * list, with nothing in any log to say why.
 */
export async function handleCuratedPlaylists(params: URLSearchParams, deps: CatalogDeps): Promise<HandlerResult> {
  let ids: string[]
  try {
    ids = readPlaylistIds(params)
  } catch (caught) {
    return badRequest(caught)
  }

  return respond(async () => {
    const found = await Promise.all(ids.map(async (id) => {
      try {
        return mapPlaylist(await spotifyAppFetch<SpotifyPlaylistApiItem>(`/playlists/${encodeURIComponent(id)}`, deps))
      } catch (caught) {
        if (isPlaylistUnavailable(caught)) return null
        throw caught
      }
    }))
    return { status: 200, body: { items: found.filter(isPresent) }, headers: cacheFor(3600) }
  })
}

/**
 * What Spotify says when it will not describe one playlist: not found, not
 * allowed (private, or one of its own editorial playlists), or not a valid id.
 */
const unavailablePlaylistStatuses = new Set([400, 403, 404])

function isPlaylistUnavailable(caught: unknown) {
  return caught instanceof SpotifyUpstreamError
    && caught.spotifyStatus !== null
    && unavailablePlaylistStatuses.has(caught.spotifyStatus)
}

interface SpotifySearchPage {
  playlists?: { next?: string | null; items?: Array<SpotifyPlaylistApiItem | null> }
  tracks?: { items?: Array<SpotifyTrackApiItem | null> }
}

/**
 * One Spotify call with the application's token. A 401 means the cached
 * token has been revoked or has expired early, so it is dropped and the call
 * is made once more — once, never in a loop.
 */
async function spotifyAppFetch<T>(path: string, deps: CatalogDeps, isRetry = false): Promise<T> {
  const credentials = readSpotifyServerCredentials(deps.env)
  const tokenDeps: AppTokenDeps = { credentials, fetch: deps.fetch, now: deps.now }
  const accessToken = await getSpotifyAppToken(tokenDeps)

  let response: Response
  try {
    response = await deps.fetch(`${SPOTIFY_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    throw new SpotifyUpstreamError(502, 'Spotify could not be reached.')
  }

  if (response.status === 401 && !isRetry) {
    invalidateAppToken()
    return spotifyAppFetch<T>(path, deps, true)
  }

  if (!response.ok) {
    throw new SpotifyUpstreamError(
      response.status === 429 ? 429 : 502,
      `Spotify answered ${response.status}.`,
      readRetryAfter(response),
      response.status,
    )
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new SpotifyUpstreamError(502, 'Spotify returned a response that could not be read.')
  }
}

/**
 * Turns whatever went wrong into an answer the visitor can be shown. Every
 * message here is generic on purpose: the deployment's configuration, the
 * application's credentials and Spotify's own wording all stay on the server.
 */
async function respond(work: () => Promise<HandlerResult>): Promise<HandlerResult> {
  try {
    return await work()
  } catch (caught) {
    if (caught instanceof SpotifyConfigurationError) {
      // The names of the missing variables, for whoever reads the function's
      // log. Never their values, and never anything sent to the browser.
      console.error(`[spotify] ${caught.message}`)
      return { status: 503, body: { error: discoveryUnavailableMessage } }
    }
    if (caught instanceof SpotifyUpstreamError) {
      if (caught.status === 429) {
        console.error('[spotify] Spotify rate-limited the application token.')
        return {
          status: 429,
          body: { error: 'Spotify is busy. Try again in a moment.' },
          headers: caught.retryAfterSeconds === null ? undefined : { 'Retry-After': String(caught.retryAfterSeconds) },
        }
      }
      console.error(`[spotify] ${caught.message}`)
      return { status: 502, body: { error: discoveryUnavailableMessage } }
    }
    console.error('[spotify] Unexpected discovery failure.')
    return { status: 500, body: { error: discoveryUnavailableMessage } }
  }
}

function badRequest(caught: unknown): HandlerResult {
  return { status: 400, body: { error: caught instanceof ValidationError ? caught.message : 'That request could not be understood.' } }
}

function readQuery(params: URLSearchParams) {
  const raw = params.get('q') ?? ''
  const trimmed = raw.trim()
  if (trimmed.length < minQueryLength) throw new ValidationError(`A search needs at least ${minQueryLength} characters.`)
  if (trimmed.length > maxQueryLength) throw new ValidationError(`A search can be at most ${maxQueryLength} characters.`)
  return trimmed
}

function readSearchType(params: URLSearchParams): CatalogSearchType {
  const raw = params.get('type')
  if (raw === null || raw === '') return 'playlist'
  const found = catalogSearchTypes.find((candidate) => candidate === raw)
  if (!found) throw new ValidationError(`Search type must be one of: ${catalogSearchTypes.join(', ')}.`)
  return found
}

function readBoundedInteger(raw: string | null, min: number, max: number, fallback: number, name: string) {
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) throw new ValidationError(`${name} must be a whole number between ${min} and ${max}.`)
  return value
}

function readPlaylistIds(params: URLSearchParams) {
  const ids = (params.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  if (ids.length === 0) throw new ValidationError('Ask for at least one playlist id.')
  if (ids.length > maxPlaylistIds) throw new ValidationError(`Ask for at most ${maxPlaylistIds} playlists at a time.`)
  // A Spotify id is base-62. Anything else is someone trying to write a path.
  if (ids.some((id) => !/^[A-Za-z0-9]{1,40}$/.test(id))) throw new ValidationError('That is not a Spotify playlist id.')
  return [...new Set(ids)]
}

function cacheFor(seconds: number) {
  // The browser re-asks (the panel's own state is the cache someone sees);
  // the CDN holds it, so a popular search is one Spotify call and not a
  // thousand. Public catalog data only: nothing here is about a visitor.
  return { 'Cache-Control': `public, max-age=0, s-maxage=${seconds}` }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}
