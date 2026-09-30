// The anonymous catalog endpoint. Spotify is stubbed throughout: an
// automated test must never reach the real service, and the point of most of
// these is what happens when it answers badly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discoveryUnavailableMessage,
  handleCatalogSearch,
  handleCuratedPlaylists,
  maxPlaylistIds,
  maxQueryLength,
} from './spotifyCatalog'
import { resetAppTokenCacheForTests } from './spotifyAppToken'

const env = { SPOTIFY_CLIENT_ID: 'app-id', SPOTIFY_CLIENT_SECRET: 'app-secret' }

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

function tokenReply() {
  return json({ access_token: 'app-token', token_type: 'bearer', expires_in: 3600 })
}

/**
 * A fetch that answers the token request first and then the Spotify calls in
 * the order given, so a test says what Spotify replies and nothing else.
 */
function spotifyStub(...replies: Array<Response | (() => Response)>) {
  const calls: string[] = []
  const queue = [...replies]
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('https://accounts.spotify.com/')) return tokenReply()
    const next = queue.shift()
    if (!next) throw new Error(`No stubbed reply for ${url}`)
    return typeof next === 'function' ? next() : next
  })
  return { fetch: fetchMock as unknown as typeof fetch, calls }
}

function params(query: Record<string, string>) {
  return new URLSearchParams(query)
}

const playlistItem = {
  id: 'p1',
  name: 'Rain on Glass',
  uri: 'spotify:playlist:p1',
  external_urls: { spotify: 'https://open.spotify.com/playlist/p1' },
  images: [{ url: 'https://images.test/p1.jpg' }],
  owner: { display_name: 'Someone' },
  tracks: { total: 42 },
}

const trackItem = {
  id: 't1',
  name: 'Xtal',
  uri: 'spotify:track:t1',
  external_urls: { spotify: 'https://open.spotify.com/track/t1' },
  artists: [{ name: 'Aphex Twin' }],
  album: { name: 'SAW 85-92', images: [{ url: 'https://images.test/t1.jpg' }] },
  duration_ms: 293_000,
}

beforeEach(() => {
  resetAppTokenCacheForTests()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Catalog search validation', () => {
  it('refuses a search with nothing much in it', async () => {
    const stub = spotifyStub()
    for (const q of ['', ' ', 'a', '  b  ']) {
      const result = await handleCatalogSearch(params({ q }), { env, fetch: stub.fetch })
      expect(result.status).toBe(400)
    }
    expect(stub.calls).toEqual([])
  })

  it('refuses a search long enough to be something other than a search', async () => {
    const stub = spotifyStub()
    const result = await handleCatalogSearch(params({ q: 'x'.repeat(maxQueryLength + 1) }), { env, fetch: stub.fetch })
    expect(result.status).toBe(400)
    expect(stub.calls).toEqual([])
  })

  it('accepts only the two kinds of search this panel offers', async () => {
    const stub = spotifyStub()
    for (const type of ['album', 'artist', 'show', 'episode', 'audiobook', 'playlist,track', 'anything']) {
      const result = await handleCatalogSearch(params({ q: 'rain', type }), { env, fetch: stub.fetch })
      expect(result.status).toBe(400)
    }
    expect(stub.calls).toEqual([])
  })

  it('defaults to playlists, which is what the panel searches first', async () => {
    const stub = spotifyStub(json({ playlists: { next: null, items: [playlistItem] } }))
    await handleCatalogSearch(params({ q: 'rain' }), { env, fetch: stub.fetch })
    expect(stub.calls.at(-1)).toContain('type=playlist')
  })

  it('caps the result count at the ten Spotify itself allows', async () => {
    const stub = spotifyStub()
    expect((await handleCatalogSearch(params({ q: 'rain', limit: '50' }), { env, fetch: stub.fetch })).status).toBe(400)
    expect((await handleCatalogSearch(params({ q: 'rain', limit: '0' }), { env, fetch: stub.fetch })).status).toBe(400)
    expect((await handleCatalogSearch(params({ q: 'rain', offset: '2000' }), { env, fetch: stub.fetch })).status).toBe(400)
    expect((await handleCatalogSearch(params({ q: 'rain', offset: 'seven' }), { env, fetch: stub.fetch })).status).toBe(400)
    expect(stub.calls).toEqual([])
  })

  // The client names a question, never a path. Anything that looked like a
  // way to reach another Spotify endpoint has to come back as a 400 rather
  // than as a request made on the application's behalf.
  it('cannot be talked into calling any other Spotify endpoint', async () => {
    const stub = spotifyStub(json({ playlists: { next: null, items: [] } }))
    await handleCatalogSearch(params({ q: '../../me/player', type: 'playlist' }), { env, fetch: stub.fetch })
    const called = stub.calls.at(-1)!
    expect(called.startsWith('https://api.spotify.com/v1/search?')).toBe(true)
    expect(called).not.toContain('/me/')
  })
})

describe('Catalog search results', () => {
  it('answers a playlist search with mapped summaries and whether there is more', async () => {
    const stub = spotifyStub(json({ playlists: { next: 'https://api.spotify.com/next', items: [playlistItem] } }))
    const result = await handleCatalogSearch(params({ q: 'rain' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      items: [{
        id: 'p1',
        name: 'Rain on Glass',
        uri: 'spotify:playlist:p1',
        url: 'https://open.spotify.com/playlist/p1',
        image: 'https://images.test/p1.jpg',
        owner: 'Someone',
        trackCount: 42,
      }],
      hasMore: true,
    })
  })

  // Spotify blanks entries in playlist search results rather than omitting
  // them. They are dropped here so the browser never has to know.
  it('drops the blanks Spotify leaves in a page of playlists', async () => {
    const stub = spotifyStub(json({ playlists: { next: null, items: [null, playlistItem, null] } }))
    const result = await handleCatalogSearch(params({ q: 'rain' }), { env, fetch: stub.fetch })
    expect((result.body as { items: unknown[] }).items).toHaveLength(1)
  })

  it('answers a song search with mapped songs', async () => {
    const stub = spotifyStub(json({ tracks: { items: [trackItem, null] } }))
    const result = await handleCatalogSearch(params({ q: 'xtal', type: 'track' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      items: [{
        id: 't1',
        name: 'Xtal',
        uri: 'spotify:track:t1',
        url: 'https://open.spotify.com/track/t1',
        image: 'https://images.test/t1.jpg',
        artists: 'Aphex Twin',
        album: 'SAW 85-92',
        durationMs: 293_000,
      }],
    })
  })

  it('answers an empty catalog page without pretending it failed', async () => {
    const stub = spotifyStub(json({ playlists: { next: null, items: [] } }))
    const result = await handleCatalogSearch(params({ q: 'zzzzzzzz' }), { env, fetch: stub.fetch })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ items: [], hasMore: false })
  })
})

describe('Curated playlist lookup', () => {
  it('prefers the canonical tracks count when an items compatibility count is also present', async () => {
    const stub = spotifyStub(json({ ...playlistItem, items: { total: 0 } }))
    const result = await handleCuratedPlaylists(params({ ids: 'p1' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(200)
    expect((result.body as { items: Array<{ trackCount: number }> }).items[0]?.trackCount).toBe(42)
  })

  it('reads each id and keeps the order it was asked in', async () => {
    const second = { ...playlistItem, id: 'p2', name: 'Night Kitchen', uri: 'spotify:playlist:p2' }
    const stub = spotifyStub(json(playlistItem), json(second))
    const result = await handleCuratedPlaylists(params({ ids: 'p1,p2' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(200)
    expect((result.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual(['p1', 'p2'])
  })

  // One id that Spotify will not serve -- deleted, private, or one of its own
  // editorial playlists -- must cost a card and not the whole row of them.
  it('leaves out an id Spotify will not serve, and keeps the rest', async () => {
    const stub = spotifyStub(new Response('{"error":{"status":404}}', { status: 404 }), json(playlistItem))
    const result = await handleCuratedPlaylists(params({ ids: 'gone,p1' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(200)
    expect((result.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual(['p1'])
  })

  it('refuses anything that is not a list of Spotify ids', async () => {
    const stub = spotifyStub()
    for (const ids of ['', '   ', '../playlists/x', 'p1,../me', 'p1 p2', 'p1,spotify:playlist:p2']) {
      expect((await handleCuratedPlaylists(params({ ids }), { env, fetch: stub.fetch })).status).toBe(400)
    }
    expect(stub.calls).toEqual([])
  })

  it('refuses a list longer than the suggestion area could use', async () => {
    const ids = Array.from({ length: maxPlaylistIds + 1 }, (_, index) => `id${index}`).join(',')
    const stub = spotifyStub()
    expect((await handleCuratedPlaylists(params({ ids }), { env, fetch: stub.fetch })).status).toBe(400)
  })
})

describe('When something goes wrong', () => {
  it('says only that discovery is unavailable when the server has no credentials', async () => {
    const stub = spotifyStub()
    const result = await handleCatalogSearch(params({ q: 'rain' }), { env: {}, fetch: stub.fetch })

    expect(result.status).toBe(503)
    expect(result.body).toEqual({ error: discoveryUnavailableMessage })
    expect(stub.calls).toEqual([])
  })

  it('takes a fresh token once when Spotify rejects the one it held', async () => {
    const stub = spotifyStub(
      new Response('{}', { status: 401 }),
      json({ playlists: { next: null, items: [playlistItem] } }),
    )
    const result = await handleCatalogSearch(params({ q: 'rain' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(200)
    expect(stub.calls.filter((url) => url.startsWith('https://accounts.spotify.com/'))).toHaveLength(2)
  })

  it('gives up after one retry rather than looping on a 401', async () => {
    const stub = spotifyStub(new Response('{}', { status: 401 }), new Response('{}', { status: 401 }))
    const result = await handleCatalogSearch(params({ q: 'rain' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(502)
    expect(stub.calls.filter((url) => url.startsWith('https://api.spotify.com/'))).toHaveLength(2)
  })

  it('passes a rate limit on as one, with Spotify\'s own Retry-After', async () => {
    const stub = spotifyStub(new Response('{}', { status: 429, headers: { 'Retry-After': '11' } }))
    const result = await handleCatalogSearch(params({ q: 'rain' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(429)
    expect(result.headers?.['Retry-After']).toBe('11')
    // One attempt. Retrying into a rate limit is how a rate limit becomes a ban.
    expect(stub.calls.filter((url) => url.startsWith('https://api.spotify.com/'))).toHaveLength(1)
  })

  // Found by testing the deployed functions directly: the per-playlist catch
  // meant to skip one unavailable playlist also swallowed "no credentials", so
  // a misconfigured deployment answered 200 with an empty list and logged
  // nothing. An empty list is a real answer; a broken deployment is not one.
  it('says the deployment is unavailable when there are no credentials, rather than an empty list', async () => {
    const stub = spotifyStub()
    const result = await handleCuratedPlaylists(params({ ids: 'p1,p2' }), { env: {}, fetch: stub.fetch })

    expect(result.status).toBe(503)
    expect(result.body).toEqual({ error: discoveryUnavailableMessage })
    expect(stub.calls).toEqual([])
    // And it is written down for whoever reads the log, naming what is missing.
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('SPOTIFY_CLIENT_ID'))
  })

  it('says so when Spotify refuses the application credentials, rather than an empty list', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"invalid_client"}', { status: 400 }))
    const result = await handleCuratedPlaylists(params({ ids: 'p1' }), { env, fetch: fetchMock as unknown as typeof fetch })

    expect(result.status).toBe(502)
    expect(result.body).toEqual({ error: discoveryUnavailableMessage })
  })

  it('says so when Spotify itself is failing, rather than treating every playlist as gone', async () => {
    const stub = spotifyStub(new Response('{}', { status: 500 }), new Response('{}', { status: 500 }))
    const result = await handleCuratedPlaylists(params({ ids: 'p1,p2' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(502)
    expect(result.body).toEqual({ error: discoveryUnavailableMessage })
  })

  // The three answers Spotify gives about one playlist it will not describe.
  it.each([400, 403, 404])('still leaves out a single playlist Spotify answers %i for', async (status) => {
    const stub = spotifyStub(new Response('{}', { status }), json(playlistItem))
    const result = await handleCuratedPlaylists(params({ ids: 'gone,p1' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(200)
    expect((result.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual(['p1'])
  })

  it('reports a rate limit during a curated lookup rather than answering with nothing', async () => {
    const stub = spotifyStub(new Response('{}', { status: 429 }))
    const result = await handleCuratedPlaylists(params({ ids: 'p1' }), { env, fetch: stub.fetch })
    expect(result.status).toBe(429)
  })

  it('treats an unreadable Spotify answer as a failure', async () => {
    const stub = spotifyStub(new Response('<html>maintenance</html>', { status: 200 }))
    const result = await handleCatalogSearch(params({ q: 'rain' }), { env, fetch: stub.fetch })

    expect(result.status).toBe(502)
    expect(result.body).toEqual({ error: discoveryUnavailableMessage })
  })

  it('survives Spotify being unreachable', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).startsWith('https://accounts.spotify.com/')) return tokenReply()
      throw new Error('socket hang up')
    })
    const result = await handleCatalogSearch(params({ q: 'rain' }), { env, fetch: fetchMock as unknown as typeof fetch })
    expect(result.status).toBe(502)
  })
})

// The single rule this endpoint exists to keep. If any of these ever fail,
// the application's Spotify credentials are reaching the browser.
describe('What is returned to the browser', () => {
  it('never carries the client secret, the application token, or an authorization header', async () => {
    const stub = spotifyStub(
      json({ playlists: { next: null, items: [playlistItem] } }),
      json(playlistItem),
      new Response('{}', { status: 500 }),
    )
    const deps = { env, fetch: stub.fetch }

    const bodies = [
      await handleCatalogSearch(params({ q: 'rain' }), deps),
      await handleCuratedPlaylists(params({ ids: 'p1' }), deps),
      await handleCatalogSearch(params({ q: 'rain' }), deps),
      await handleCatalogSearch(params({ q: 'a' }), deps),
      await handleCatalogSearch(params({ q: 'rain' }), { env: {}, fetch: stub.fetch }),
    ].map((result) => JSON.stringify(result))

    for (const body of bodies) {
      expect(body).not.toContain('app-secret')
      expect(body).not.toContain('app-token')
      expect(body).not.toContain(btoa('app-id:app-secret'))
      expect(body.toLowerCase()).not.toContain('authorization')
      expect(body.toLowerCase()).not.toContain('client_credentials')
    }
  })
})
