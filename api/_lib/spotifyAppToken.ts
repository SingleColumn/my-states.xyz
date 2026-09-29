/**
 * The application's own Spotify token — the Client Credentials flow.
 *
 * This authenticates *this app* to Spotify, never a visitor. It reaches only
 * the endpoints that carry no user data, which is exactly what anonymous
 * catalog browsing needs. It is a separate thing from the browser's
 * Authorization Code + PKCE token in src/spotify.ts, which authenticates the
 * visitor for playback, and the two must never be mistaken for one another:
 * this one is minted from a secret and must never leave the server.
 *
 * Nothing here is logged. A credential that reaches a log has left the
 * server as surely as one that reaches the browser.
 */

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'

/**
 * Renew this long before Spotify's own expiry, so a token that is about to
 * turn over is never the one handed to a request that then takes a second.
 */
const renewBeforeExpiryMs = 60_000

/** Raised when the deployment has no application credentials configured. */
export class SpotifyConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpotifyConfigurationError'
  }
}

/** Raised when Spotify itself answered with something other than success. */
export class SpotifyUpstreamError extends Error {
  /** What this app answers with: 429 for a rate limit, otherwise 502. */
  readonly status: number
  readonly retryAfterSeconds: number | null
  /**
   * What Spotify itself answered, for a call about one resource. It is what
   * tells "this playlist is not available" (404) from "Spotify is unwell"
   * (500), which `status` deliberately flattens. Null when there was no such
   * answer: the token request, or Spotify not being reached at all.
   */
  readonly spotifyStatus: number | null

  constructor(status: number, message: string, retryAfterSeconds: number | null = null, spotifyStatus: number | null = null) {
    super(message)
    this.name = 'SpotifyUpstreamError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
    this.spotifyStatus = spotifyStatus
  }
}

export interface SpotifyServerCredentials {
  clientId: string
  clientSecret: string
}

export interface AppTokenDeps {
  credentials: SpotifyServerCredentials
  fetch: typeof globalThis.fetch
  now?: () => number
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}

/**
 * A module-level cache. Vercel recycles instances, so this is a warm-start
 * optimisation and not a store: every path below works from a cold start,
 * where the cache is simply empty.
 */
let cached: CachedToken | null = null
/** Concurrent cold-start requests share one token request rather than racing. */
let inFlight: Promise<string> | null = null

/**
 * Reads the two server-only variables. They carry no `VITE_` prefix on
 * purpose: that prefix is what Vite inlines into the browser bundle, and the
 * secret must never be inlined anywhere.
 */
export function readSpotifyServerCredentials(env: Record<string, string | undefined>): SpotifyServerCredentials {
  const clientId = env.SPOTIFY_CLIENT_ID?.trim()
  const clientSecret = env.SPOTIFY_CLIENT_SECRET?.trim()
  const missing = [
    clientId ? null : 'SPOTIFY_CLIENT_ID',
    clientSecret ? null : 'SPOTIFY_CLIENT_SECRET',
  ].filter((name): name is string => name !== null)

  // The names of what is missing, never a value: this message is for the
  // deployment log, and the visitor is told something generic instead.
  if (missing.length > 0) throw new SpotifyConfigurationError(`Spotify discovery is not configured: set ${missing.join(' and ')}.`)
  return { clientId: clientId!, clientSecret: clientSecret! }
}

/** Forgets the cached token, so the next call mints a new one. Used after a 401. */
export function invalidateAppToken() {
  cached = null
  inFlight = null
}

/** Test seam: the cache is module state, and a test must be able to start empty. */
export function resetAppTokenCacheForTests() {
  invalidateAppToken()
}

export async function getSpotifyAppToken(deps: AppTokenDeps): Promise<string> {
  const now = deps.now ?? Date.now
  const current = cached
  if (current && current.expiresAt - now() > renewBeforeExpiryMs) return current.accessToken
  if (inFlight) return inFlight

  const request = requestAppToken(deps, now)
  inFlight = request
  try {
    return await request
  } finally {
    if (inFlight === request) inFlight = null
  }
}

async function requestAppToken(deps: AppTokenDeps, now: () => number): Promise<string> {
  const { clientId, clientSecret } = deps.credentials
  // btoa is a web global and is present on both Vercel's Node runtime and in
  // the dev server, which keeps this module free of Node-only imports.
  const basic = btoa(`${clientId}:${clientSecret}`)

  let response: Response
  try {
    response = await deps.fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
  } catch {
    throw new SpotifyUpstreamError(502, 'Spotify could not be reached.')
  }

  if (!response.ok) {
    // Spotify's own message could name the app; the status is all the caller
    // needs, and all the visitor is told about.
    throw new SpotifyUpstreamError(
      response.status === 429 ? 429 : 502,
      `Spotify refused the application credentials (${response.status}).`,
      readRetryAfter(response),
    )
  }

  let json: { access_token?: unknown; expires_in?: unknown }
  try {
    json = (await response.json()) as { access_token?: unknown; expires_in?: unknown }
  } catch {
    throw new SpotifyUpstreamError(502, 'Spotify returned a token response that could not be read.')
  }

  const accessToken = typeof json.access_token === 'string' ? json.access_token : null
  const expiresIn = typeof json.expires_in === 'number' && Number.isFinite(json.expires_in) ? json.expires_in : null
  if (!accessToken || !expiresIn) throw new SpotifyUpstreamError(502, 'Spotify returned a token response that could not be read.')

  cached = { accessToken, expiresAt: now() + expiresIn * 1000 }
  return accessToken
}

export function readRetryAfter(response: { headers: { get(name: string): string | null } }): number | null {
  const header = response.headers.get('Retry-After')
  if (!header) return null
  const seconds = Number.parseInt(header, 10)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}
