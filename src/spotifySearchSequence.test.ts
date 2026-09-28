// @vitest-environment jsdom
//
// Searching while someone types means several answers can be in the air at
// once, and only the newest is still wanted. Which one is allowed to land is
// decided inside useSpotifyState and nowhere else: the panel sees the answer,
// never the race that chose it. So these drive the hook directly, holding
// replies open until a later request or a cleared box has overtaken them.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PanelsState } from './AppState'

const tokens = { accessToken: 'test-token', refreshToken: 'refresh', expiresAt: Date.now() + 600_000 }

const fetchMock = vi.hoisted(() => ({ spotifyFetch: vi.fn() }))

vi.mock('./spotify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./spotify')>()),
  spotifyFetch: fetchMock.spotifyFetch,
}))

vi.mock('./storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage')>()),
  loadSpotifyTokens: () => tokens,
  saveSpotifyTokens: () => {},
}))

const panels = { all: [], get: () => undefined } as unknown as PanelsState

// With tokens in hand the hook connects a Web Playback device, which would
// otherwise mean a <script> jsdom never loads and a promise that never
// settles alongside the searches under test. A player that is already there
// is the quiet way to say there is nothing to fetch.
function stubWebPlaybackSdk() {
  class FakePlayer {
    addListener() {}
    removeListener() {}
    async connect() { return true }
    disconnect() {}
  }
  Object.defineProperty(window, 'Spotify', { configurable: true, value: { Player: FakePlayer } })
}

/** A reply this test holds open, to be let go once something has overtaken it. */
function deferred<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => { release = resolve })
  return { promise, release }
}

function playlistPage(names: string[]) {
  return {
    playlists: {
      next: null,
      items: names.map((name, index) => ({
        id: `${name}-${index}`,
        name,
        uri: `spotify:playlist:${name}`,
        external_urls: { spotify: `https://open.spotify.com/playlist/${name}` },
        images: [],
        owner: { display_name: 'Owner' },
        tracks: { total: 10 },
      })),
    },
  }
}

async function mountSpotifyState() {
  const { useSpotifyState } = await import('./AppState')
  return renderHook(() => useSpotifyState(null, panels))
}

beforeEach(() => {
  fetchMock.spotifyFetch.mockReset()
  stubWebPlaybackSdk()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Spotify search, when answers arrive out of order', () => {
  it('keeps the newest search and drops the one it overtook', async () => {
    const slow = deferred<unknown>()
    fetchMock.spotifyFetch
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(playlistPage(['Jazz Classics']))

    const { result } = await mountSpotifyState()

    let firstSearch!: Promise<void>
    await act(async () => { firstSearch = result.current.searchPlaylists('jaz') })
    await act(async () => { await result.current.searchPlaylists('jazz') })

    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(['Jazz Classics'])

    // The overtaken reply comes back last, and must change nothing.
    await act(async () => {
      slow.release(playlistPage(['Jazzy Nonsense']))
      await firstSearch
    })

    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(['Jazz Classics'])
  })

  // Found in review: clearing the box emptied the arrays but left the sequence
  // alone, so a reply already on its way still passed the guard and refilled
  // the list underneath an empty field.
  it('does not refill a list that was cleared while it was still asking', async () => {
    const slow = deferred<unknown>()
    fetchMock.spotifyFetch.mockReturnValueOnce(slow.promise)

    const { result } = await mountSpotifyState()

    let search!: Promise<void>
    await act(async () => { search = result.current.searchPlaylists('jazz') })

    act(() => { result.current.clearSearchResults() })

    await act(async () => {
      slow.release(playlistPage(['Too Late']))
      await search
    })

    expect(result.current.playlists).toEqual([])
  })

  it('does not let a song search land under a playlist search that followed it', async () => {
    const slow = deferred<unknown>()
    fetchMock.spotifyFetch
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(playlistPage(['Playlist Wins']))

    const { result } = await mountSpotifyState()

    let trackSearch!: Promise<void>
    await act(async () => { trackSearch = result.current.searchTracks('aphex') })
    await act(async () => { await result.current.searchPlaylists('aphex') })

    await act(async () => {
      slow.release({ tracks: { items: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:1', external_urls: { spotify: '' }, artists: [{ name: 'Aphex Twin' }], album: { name: 'SAW 85-92', images: [] }, duration_ms: 1000 }] } })
      await trackSearch
    })

    expect(result.current.tracks).toEqual([])
    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(['Playlist Wins'])
  })
})
