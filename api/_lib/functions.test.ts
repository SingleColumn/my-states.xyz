// The two files Vercel actually deploys, imported as Vercel will import them
// and called the way it will call them: with a Web `Request`, expecting a Web
// `Response`. The logic behind them is tested elsewhere; this is about the
// shape they are exported in, and what they refuse before any logic runs.
//
// This file sits in api/_lib/ on purpose. Vercel deploys every file directly
// under api/ as a function, and a test file must not become one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as searchModule from '../spotify/search'
import * as playlistsModule from '../spotify/playlists'
import { resetAppTokenCacheForTests } from './spotifyAppToken'

const search = searchModule.default
const playlists = playlistsModule.default

let network: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetAppTokenCacheForTests()
  // Nothing here may reach Spotify. A call would throw and fail the test.
  network = vi.fn(() => { throw new Error('These tests must not touch the network.') })
  vi.stubGlobal('fetch', network)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function get(path: string) {
  return new Request(`https://example.test${path}`)
}

describe('The shape Vercel is given', () => {
  // One documented shape per file. A file that also exported a named GET would
  // leave it to Vercel to choose between them.
  it('exports exactly one thing from each function: the default { fetch } handler', () => {
    expect(Object.keys(searchModule)).toEqual(['default'])
    expect(Object.keys(playlistsModule)).toEqual(['default'])
    expect(typeof search.fetch).toBe('function')
    expect(typeof playlists.fetch).toBe('function')
  })

  it('answers a Request with a Response carrying JSON', async () => {
    const response = await search.fetch(get('/api/spotify/search?q=a'))

    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: expect.any(String) })
  })
})

describe('What each function refuses before any catalog code runs', () => {
  it('turns away a search that is too short, with a 400', async () => {
    expect((await search.fetch(get('/api/spotify/search?q=a'))).status).toBe(400)
    expect((await search.fetch(get('/api/spotify/search'))).status).toBe(400)
  })

  it('turns away a playlist lookup that is not a list of ids, with a 400', async () => {
    expect((await playlists.fetch(get('/api/spotify/playlists?ids=../me'))).status).toBe(400)
    expect((await playlists.fetch(get('/api/spotify/playlists'))).status).toBe(400)
  })

  // A default { fetch } export is handed every HTTP method, where a named GET
  // would only ever have been handed GET. These endpoints read and nothing
  // else, so the rest are refused here.
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s with a 405 that says what is allowed', async (method) => {
    for (const [fn, path] of [[search, '/api/spotify/search?q=rain'], [playlists, '/api/spotify/playlists?ids=abc123']] as const) {
      const response = await fn.fetch(new Request(`https://example.test${path}`, { method, body: method === 'DELETE' ? undefined : '{}' }))

      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('GET')
    }
    expect(network).not.toHaveBeenCalled()
  })
})

describe('A deployment with no Spotify credentials', () => {
  beforeEach(() => {
    vi.stubEnv('SPOTIFY_CLIENT_ID', '')
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', '')
  })

  it('says only that discovery is unavailable, and asks Spotify nothing', async () => {
    const response = await search.fetch(get('/api/spotify/search?q=rain'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Spotify discovery is temporarily unavailable.' })
    expect(network).not.toHaveBeenCalled()
  })

  it('does the same for a playlist lookup', async () => {
    const response = await playlists.fetch(get('/api/spotify/playlists?ids=abc123'))

    expect(response.status).toBe(503)
    expect(network).not.toHaveBeenCalled()
  })
})
