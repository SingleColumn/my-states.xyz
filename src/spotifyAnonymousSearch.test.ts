// @vitest-environment jsdom
//
// Where a search goes when nobody has connected Spotify.
//
// The panel above cannot tell the difference and must not have to: the same
// call, the same shape of answer, the same sequence guard. What changes is
// who asks Spotify — the visitor's own token, or this app's own endpoint with
// the application's credentials, which is the only thing a visitor without a
// Spotify session could possibly use.
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PanelsState } from './AppState'
import type { Panel } from './types'

const session = vi.hoisted(() => ({ tokens: null as unknown }))
const spotifyApi = vi.hoisted(() => ({ spotifyFetch: vi.fn() }))
const catalog = vi.hoisted(() => ({
  searchCatalogPlaylists: vi.fn(),
  searchCatalogTracks: vi.fn(),
  fetchCuratedPlaylists: vi.fn(async () => []),
}))

vi.mock('./spotify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./spotify')>()),
  spotifyFetch: spotifyApi.spotifyFetch,
}))

vi.mock('./spotifyCatalog', () => catalog)

vi.mock('./storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage')>()),
  loadSpotifyTokens: () => session.tokens,
  saveSpotifyTokens: () => {},
}))

const musicPanel = {
  id: 'panel_music',
  type: 'spotify',
  visible: true,
  focusView: false,
  // With artwork already in hand, nothing sets off the lookup that fills it
  // in, so these tests only exercise what they are about.
  config: { playlist: { id: 'p0', uri: 'spotify:playlist:p0', name: 'Held', url: '', image: 'https://images.test/p0.jpg' } },
} as unknown as Panel<'spotify'>

function panelsStub() {
  const updateConfig = vi.fn()
  const panels = {
    all: [musicPanel],
    isReady: true,
    get: (id: string) => (id === musicPanel.id ? musicPanel : undefined),
    updateConfig,
  } as unknown as PanelsState
  return { panels, updateConfig }
}

function playlistSummaries(names: string[]) {
  return names.map((name, index) => ({
    id: `${name}-${index}`,
    name,
    uri: `spotify:playlist:${name}`,
    url: `https://open.spotify.com/playlist/${name}`,
    image: null,
    owner: 'Someone',
    trackCount: 20,
  }))
}

/** A reply this test holds open, to be let go once something has overtaken it. */
function deferred<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => { release = resolve })
  return { promise, release }
}

async function mountSpotifyState(panels: PanelsState) {
  const { useSpotifyState } = await import('./AppState')
  return renderHook(() => useSpotifyState(null, panels))
}

// Loading the app module pulls in tldraw, which under a full parallel run can
// take longer than a single test is allowed. Without this the first test to
// run pays for the load inside its own clock, times out, and every hook it
// would have returned is null. Loaded once, before any test's clock starts.
beforeAll(async () => {
  await import('./AppState')
}, 120_000)

beforeEach(() => {
  session.tokens = null
  spotifyApi.spotifyFetch.mockReset()
  catalog.searchCatalogPlaylists.mockReset()
  catalog.searchCatalogTracks.mockReset()
  catalog.fetchCuratedPlaylists.mockReset().mockResolvedValue([])
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Searching Spotify with no Spotify session', () => {
  it('asks this app\'s own endpoint, and never Spotify directly', async () => {
    catalog.searchCatalogPlaylists.mockResolvedValue({ items: playlistSummaries(['Rain on Glass']), hasMore: false })
    const { panels } = panelsStub()
    const { result } = await mountSpotifyState(panels)

    await act(async () => { await result.current.searchPlaylists('rain') })

    expect(catalog.searchCatalogPlaylists).toHaveBeenCalledWith('rain', 0)
    expect(spotifyApi.spotifyFetch).not.toHaveBeenCalled()
    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(['Rain on Glass'])
  })

  it('searches songs the same way', async () => {
    catalog.searchCatalogTracks.mockResolvedValue({
      items: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }],
    })
    const { panels } = panelsStub()
    const { result } = await mountSpotifyState(panels)

    await act(async () => { await result.current.searchTracks('xtal') })

    expect(catalog.searchCatalogTracks).toHaveBeenCalled()
    expect(spotifyApi.spotifyFetch).not.toHaveBeenCalled()
    expect(result.current.tracks.map((track) => track.name)).toEqual(['Xtal'])
  })

  // Spotify blanks entries in a page of playlist results, so a full page can
  // arrive nearly empty. The rule that fetches one more page straight away is
  // the panel's, not the token's, and applies to either path.
  it('fetches a second page when the first comes back thin', async () => {
    catalog.searchCatalogPlaylists
      .mockResolvedValueOnce({ items: playlistSummaries(['One', 'Two']), hasMore: true })
      .mockResolvedValueOnce({ items: playlistSummaries(['Three']), hasMore: false })
    const { panels } = panelsStub()
    const { result } = await mountSpotifyState(panels)

    await act(async () => { await result.current.searchPlaylists('rain') })

    expect(catalog.searchCatalogPlaylists).toHaveBeenNthCalledWith(2, 'rain', 10)
    expect(result.current.playlists).toHaveLength(3)
    expect(result.current.playlistsHaveMore).toBe(false)
  })

  it('drops a reply that a later search has already overtaken', async () => {
    const slow = deferred<unknown>()
    catalog.searchCatalogPlaylists
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ items: playlistSummaries(['Jazz Classics']), hasMore: false })
    const { panels } = panelsStub()
    const { result } = await mountSpotifyState(panels)

    let firstSearch!: Promise<void>
    await act(async () => { firstSearch = result.current.searchPlaylists('jaz') })
    await act(async () => { await result.current.searchPlaylists('jazz') })

    await act(async () => {
      slow.release({ items: playlistSummaries(['Jazzy Nonsense']), hasMore: false })
      await firstSearch
    })

    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(['Jazz Classics'])
  })

  it('does not refill a list that was cleared while it was still asking', async () => {
    const slow = deferred<unknown>()
    catalog.searchCatalogPlaylists.mockReturnValueOnce(slow.promise)
    const { panels } = panelsStub()
    const { result } = await mountSpotifyState(panels)

    let search!: Promise<void>
    await act(async () => { search = result.current.searchPlaylists('jazz') })
    act(() => { result.current.clearSearchResults() })
    await act(async () => {
      slow.release({ items: playlistSummaries(['Too Late']), hasMore: false })
      await search
    })

    expect(result.current.playlists).toEqual([])
  })
})

describe('Searching Spotify with a session', () => {
  it('goes to Spotify with the visitor\'s own token, not through this app', async () => {
    session.tokens = { accessToken: 'user-token', refreshToken: 'refresh', expiresAt: Date.now() + 600_000 }
    spotifyApi.spotifyFetch.mockResolvedValue({
      playlists: {
        next: null,
        items: [{ id: 'p1', name: 'Theirs', uri: 'spotify:playlist:p1', external_urls: { spotify: '' }, images: [], owner: { display_name: 'Someone' }, tracks: { total: 5 } }],
      },
    })
    const { panels } = panelsStub()
    const { result } = await mountSpotifyState(panels)

    await act(async () => { await result.current.searchPlaylists('rain') })

    expect(spotifyApi.spotifyFetch).toHaveBeenCalled()
    expect(catalog.searchCatalogPlaylists).not.toHaveBeenCalled()
    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(['Theirs'])
  })
})

describe('Choosing a playlist', () => {
  it('writes it to the panel and asks Spotify to play nothing at all', async () => {
    const { panels, updateConfig } = panelsStub()
    const { result } = await mountSpotifyState(panels)

    act(() => {
      result.current.selectPlaylist({
        id: 'p1', name: 'Rain on Glass', uri: 'spotify:playlist:p1', url: 'https://open.spotify.com/playlist/p1', image: null, owner: 'Someone', trackCount: 40,
      }, 'panel_music')
    })

    expect(updateConfig).toHaveBeenCalledWith('panel_music', {
      playlist: { id: 'p1', uri: 'spotify:playlist:p1', name: 'Rain on Glass', url: 'https://open.spotify.com/playlist/p1', image: null },
    }, undefined)
    expect(spotifyApi.spotifyFetch).not.toHaveBeenCalled()
  })

  // A playlist reference is public metadata about a playlist. Nothing that
  // could identify a visitor, and nothing that could authorise anything, is
  // allowed into what a moment keeps.
  it('keeps nothing but public metadata in what the moment stores', async () => {
    session.tokens = { accessToken: 'user-token', refreshToken: 'refresh', expiresAt: Date.now() + 600_000 }
    const { panels, updateConfig } = panelsStub()
    const { result } = await mountSpotifyState(panels)

    act(() => {
      result.current.selectPlaylist({
        id: 'p1', name: 'Rain on Glass', uri: 'spotify:playlist:p1', url: '', image: null, owner: 'Someone', trackCount: 40,
      }, 'panel_music')
    })

    const written = JSON.stringify(updateConfig.mock.calls.at(-1))
    expect(Object.keys((updateConfig.mock.calls.at(-1) as unknown as [string, { playlist: object }])[1].playlist).sort())
      .toEqual(['id', 'image', 'name', 'uri', 'url'])
    expect(written).not.toContain('user-token')
    expect(written).not.toContain('refresh')
  })

  it('remembers a chosen song only for as long as the page is open', async () => {
    const { panels, updateConfig } = panelsStub()
    const { result } = await mountSpotifyState(panels)
    const song = { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }

    act(() => { result.current.selectTrack(song) })
    expect(result.current.selectedTrack).toEqual(song)
    // A song is a step on the way to a playlist, so it is not what a moment
    // is reopened on: nothing is written to the panel.
    expect(updateConfig).not.toHaveBeenCalled()

    act(() => { result.current.selectTrack(null) })
    expect(result.current.selectedTrack).toBeNull()
  })

  // Found in review: a song chosen first outranks the panel's playlist wherever
  // the panel decides what is chosen. Left in place, the panel kept describing
  // the song after a playlist was picked, and after connecting Play started the
  // old song instead of the playlist chosen most recently.
  it('lets the most recent choice win: a playlist chosen after a song replaces it', async () => {
    const { panels, updateConfig } = panelsStub()
    const { result } = await mountSpotifyState(panels)
    const song = { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }

    act(() => { result.current.selectTrack(song) })
    expect(result.current.selectedTrack).toEqual(song)

    act(() => {
      result.current.selectPlaylist({
        id: 'p1', name: 'Rain on Glass', uri: 'spotify:playlist:p1', url: '', image: null, owner: 'Someone', trackCount: 40,
      }, 'panel_music')
    })

    expect(result.current.selectedTrack).toBeNull()
    expect(updateConfig).toHaveBeenCalledWith('panel_music', expect.objectContaining({ playlist: expect.objectContaining({ id: 'p1' }) }), undefined)
  })

  it('lets a song chosen after a playlist take over, as it always did', async () => {
    const { panels } = panelsStub()
    const { result } = await mountSpotifyState(panels)
    const song = { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }

    act(() => {
      result.current.selectPlaylist({
        id: 'p1', name: 'Rain on Glass', uri: 'spotify:playlist:p1', url: '', image: null, owner: 'Someone', trackCount: 40,
      }, 'panel_music')
    })
    act(() => { result.current.selectTrack(song) })

    expect(result.current.selectedTrack).toEqual(song)
  })
})
