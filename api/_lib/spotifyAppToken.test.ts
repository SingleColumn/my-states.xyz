// The application's own Spotify token: minted from a secret, cached, and
// never allowed anywhere near the browser. These drive the module directly
// with a stubbed fetch — nothing here reaches the real Spotify service.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSpotifyAppToken,
  invalidateAppToken,
  readSpotifyServerCredentials,
  resetAppTokenCacheForTests,
  SpotifyConfigurationError,
  SpotifyUpstreamError,
} from './spotifyAppToken'

const credentials = { clientId: 'app-id', clientSecret: 'app-secret' }

function tokenReply(accessToken: string, expiresIn = 3600) {
  return new Response(JSON.stringify({ access_token: accessToken, token_type: 'bearer', expires_in: expiresIn }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  resetAppTokenCacheForTests()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Spotify application credentials', () => {
  it('reads the two server-only variables', () => {
    expect(readSpotifyServerCredentials({ SPOTIFY_CLIENT_ID: ' app-id ', SPOTIFY_CLIENT_SECRET: 'app-secret' }))
      .toEqual({ clientId: 'app-id', clientSecret: 'app-secret' })
  })

  // The message goes to the deployment log, so it names what is missing --
  // and only what is missing.
  it('names the missing variables without quoting any value', () => {
    expect(() => readSpotifyServerCredentials({ SPOTIFY_CLIENT_ID: 'app-id' }))
      .toThrow(SpotifyConfigurationError)
    expect(() => readSpotifyServerCredentials({})).toThrow(/SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET/)
    expect(() => readSpotifyServerCredentials({ SPOTIFY_CLIENT_ID: 'app-id', SPOTIFY_CLIENT_SECRET: '   ' }))
      .toThrow(/SPOTIFY_CLIENT_SECRET/)
  })

  it('refuses a VITE_-prefixed secret, which would be a browser variable', () => {
    expect(() => readSpotifyServerCredentials({ VITE_SPOTIFY_CLIENT_ID: 'app-id', VITE_SPOTIFY_CLIENT_SECRET: 'app-secret' }))
      .toThrow(SpotifyConfigurationError)
  })
})

describe('Spotify application token', () => {
  it('asks Spotify for a client-credentials token, authenticating with the secret', async () => {
    const fetchMock = vi.fn(async () => tokenReply('token-1'))
    const token = await getSpotifyAppToken({ credentials, fetch: fetchMock as unknown as typeof fetch })

    expect(token).toBe('token-1')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://accounts.spotify.com/api/token')
    expect(init.body).toBe('grant_type=client_credentials')
    expect((init.headers as Record<string, string>).Authorization)
      .toBe(`Basic ${btoa('app-id:app-secret')}`)
  })

  it('reuses the token it already has rather than minting one per request', async () => {
    const fetchMock = vi.fn(async () => tokenReply('token-1'))
    const deps = { credentials, fetch: fetchMock as unknown as typeof fetch }

    expect(await getSpotifyAppToken(deps)).toBe('token-1')
    expect(await getSpotifyAppToken(deps)).toBe('token-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // Concurrent cold-start requests must not each open their own token
  // request: the first one is the one they all wait on.
  it('shares one token request between callers that arrive together', async () => {
    const fetchMock = vi.fn(async () => tokenReply('token-1'))
    const deps = { credentials, fetch: fetchMock as unknown as typeof fetch }

    const [first, second] = await Promise.all([getSpotifyAppToken(deps), getSpotifyAppToken(deps)])
    expect([first, second]).toEqual(['token-1', 'token-1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('takes a new token shortly before the one it holds expires', async () => {
    let now = 1_000_000
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenReply('token-1', 3600))
      .mockResolvedValueOnce(tokenReply('token-2', 3600))
    const deps = { credentials, fetch: fetchMock as unknown as typeof fetch, now: () => now }

    expect(await getSpotifyAppToken(deps)).toBe('token-1')

    // Still comfortably inside the hour: the same token.
    now += 3_000_000
    expect(await getSpotifyAppToken(deps)).toBe('token-1')

    // Inside the last minute, where a token could turn over mid-request.
    now += 570_000
    expect(await getSpotifyAppToken(deps)).toBe('token-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('mints a new token after the cache has been dropped', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenReply('token-1'))
      .mockResolvedValueOnce(tokenReply('token-2'))
    const deps = { credentials, fetch: fetchMock as unknown as typeof fetch }

    expect(await getSpotifyAppToken(deps)).toBe('token-1')
    invalidateAppToken()
    expect(await getSpotifyAppToken(deps)).toBe('token-2')
  })

  it('reports a refused credential without repeating what Spotify said about it', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"invalid_client"}', { status: 400 }))
    await expect(getSpotifyAppToken({ credentials, fetch: fetchMock as unknown as typeof fetch }))
      .rejects.toThrow(SpotifyUpstreamError)
  })

  it('carries a rate limit through as a rate limit, with its Retry-After', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }))
    await expect(getSpotifyAppToken({ credentials, fetch: fetchMock as unknown as typeof fetch }))
      .rejects.toMatchObject({ status: 429, retryAfterSeconds: 7 })
  })

  it('treats a malformed token response as a failure rather than caching nonsense', async () => {
    const fetchMock = vi.fn(async () => new Response('not json at all', { status: 200 }))
    await expect(getSpotifyAppToken({ credentials, fetch: fetchMock as unknown as typeof fetch }))
      .rejects.toThrow(SpotifyUpstreamError)

    const secondFetch = vi.fn(async () => tokenReply('token-1'))
    expect(await getSpotifyAppToken({ credentials, fetch: secondFetch as unknown as typeof fetch })).toBe('token-1')
  })

  it('treats a response missing the token as malformed', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 }))
    await expect(getSpotifyAppToken({ credentials, fetch: fetchMock as unknown as typeof fetch }))
      .rejects.toThrow(SpotifyUpstreamError)
  })
})
