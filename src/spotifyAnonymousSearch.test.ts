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
const spotifyApi = vi.hoisted(() => ({ spotifyFetch: vi.fn(), exchangeSpotifyCode: vi.fn() }))
const catalog = vi.hoisted(() => ({
  searchCatalogPlaylists: vi.fn(),
  searchCatalogTracks: vi.fn(),
  fetchCuratedPlaylists: vi.fn(async (_ids: string[]): Promise<unknown[]> => []),
}))

vi.mock('./spotify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./spotify')>()),
  spotifyFetch: spotifyApi.spotifyFetch,
  exchangeSpotifyCode: spotifyApi.exchangeSpotifyCode,
}))

vi.mock('./spotifyCatalog', () => catalog)

vi.mock('./storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storage')>()),
  loadSpotifyTokens: () => session.tokens,
  saveSpotifyTokens: () => {},
}))

// With artwork already in hand, nothing sets off the lookup that fills it in,
// so most of these tests only exercise what they are about. The ones that are
// about that lookup hand in a playlist without a picture.
const heldPlaylist = { id: 'p0', uri: 'spotify:playlist:p0', name: 'Held', url: '', image: 'https://images.test/p0.jpg' }
const savedWithoutArtwork = { id: 's1', uri: 'spotify:playlist:s1', name: 'Saved Earlier', url: 'https://open.spotify.com/playlist/s1', image: null }

function panelsStub(playlist: { id: string; uri: string; name: string; url: string; image: string | null } = heldPlaylist) {
  const musicPanel = {
    id: 'panel_music',
    type: 'spotify',
    visible: true,
    focusView: false,
    config: { playlist },
  } as unknown as Panel<'spotify'>
  const updateConfig = vi.fn()
  const panels = {
    all: [musicPanel],
    isReady: true,
    get: (id: string) => (id === musicPanel.id ? musicPanel : undefined),
    updateConfig,
  } as unknown as PanelsState
  return { panels, updateConfig }
}

/** The Web Playback SDK, holding on to what the hook asks it to listen for so a test can say the device is ready. */
function stubWebPlaybackSdk() {
  const listeners = new Map<string, (payload: unknown) => void>()
  class FakePlayer {
    addListener(event: string, callback: (payload: unknown) => void) { listeners.set(event, callback) }
    removeListener() {}
    async connect() { return true }
    disconnect() {}
  }
  Object.defineProperty(window, 'Spotify', { configurable: true, value: { Player: FakePlayer } })
  return listeners
}

const spotifyPlaylistItem = {
  id: 's1',
  name: 'Saved Earlier',
  uri: 'spotify:playlist:s1',
  external_urls: { spotify: 'https://open.spotify.com/playlist/s1' },
  images: [{ url: 'https://images.test/s1.jpg' }],
  owner: { display_name: 'Someone' },
  tracks: { total: 3 },
}

const userTokens = { accessToken: 'user-token', refreshToken: 'refresh', expiresAt: Date.now() + 600_000 }

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
  spotifyApi.exchangeSpotifyCode.mockReset()
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

// A playlist saved before the panel showed artwork, or arriving with an
// imported moment, has a name and no picture, and the panel looks the picture
// up once. "Once" must not mean "once, even if that one attempt never got an
// answer" -- and must not mean the app's attempt before connecting rules out
// the visitor's own attempt after. Found in review.
describe('Looking up the artwork of a saved playlist', () => {
  const connecting = async (result: { current: { handleCallback(code: string, state: string | null): Promise<void> } }) => {
    spotifyApi.exchangeSpotifyCode.mockResolvedValue(userTokens)
    await act(async () => { await result.current.handleCallback('code', 'state') })
    await act(async () => {})
  }

  it('asks the app\'s catalog first when nobody has connected', async () => {
    catalog.fetchCuratedPlaylists.mockResolvedValue([{ ...playlistSummaries(['Saved Earlier'])[0], id: 's1', image: 'https://images.test/s1.jpg' }])
    const { panels, updateConfig } = panelsStub(savedWithoutArtwork)
    await mountSpotifyState(panels)
    await act(async () => {})

    expect(catalog.fetchCuratedPlaylists).toHaveBeenCalledWith(['s1'])
    expect(spotifyApi.spotifyFetch).not.toHaveBeenCalled()
    // The app filling in a picture is not the person's choice, so it is not history.
    expect(updateConfig).toHaveBeenCalledWith('panel_music', { playlist: expect.objectContaining({ id: 's1', image: 'https://images.test/s1.jpg' }) }, { history: 'ignore' })
  })

  it('tries again with the visitor\'s own account when the app\'s attempt failed', async () => {
    catalog.fetchCuratedPlaylists.mockRejectedValue(new Error('discovery is not configured'))
    spotifyApi.spotifyFetch.mockResolvedValue(spotifyPlaylistItem)
    const { panels, updateConfig } = panelsStub(savedWithoutArtwork)
    const { result } = await mountSpotifyState(panels)
    await act(async () => {})

    expect(catalog.fetchCuratedPlaylists).toHaveBeenCalledTimes(1)
    expect(updateConfig).not.toHaveBeenCalled()

    await connecting(result)

    expect(spotifyApi.spotifyFetch).toHaveBeenCalledWith('/playlists/s1', 'user-token')
    expect(updateConfig).toHaveBeenCalledWith('panel_music', { playlist: expect.objectContaining({ id: 's1', image: 'https://images.test/s1.jpg' }) }, { history: 'ignore' })
  })

  // The app can only describe a public playlist. A private one comes back
  // empty, which says nothing about what the visitor's own account can see.
  it('tries again with the visitor\'s own account when the app was told there was nothing to find', async () => {
    catalog.fetchCuratedPlaylists.mockResolvedValue([])
    spotifyApi.spotifyFetch.mockResolvedValue(spotifyPlaylistItem)
    const { panels, updateConfig } = panelsStub(savedWithoutArtwork)
    const { result } = await mountSpotifyState(panels)
    await act(async () => {})
    expect(updateConfig).not.toHaveBeenCalled()

    await connecting(result)

    expect(spotifyApi.spotifyFetch).toHaveBeenCalledWith('/playlists/s1', 'user-token')
    expect(updateConfig).toHaveBeenCalledTimes(1)
  })

  it('is not lost when connecting cuts the app\'s attempt short, and the late answer changes nothing', async () => {
    const slow = deferred<unknown[]>()
    catalog.fetchCuratedPlaylists.mockReturnValue(slow.promise)
    spotifyApi.spotifyFetch.mockResolvedValue(spotifyPlaylistItem)
    const { panels, updateConfig } = panelsStub(savedWithoutArtwork)
    const { result } = await mountSpotifyState(panels)
    await act(async () => {})

    await connecting(result)
    expect(updateConfig).toHaveBeenCalledTimes(1)

    await act(async () => {
      slow.release([{ ...playlistSummaries(['Saved Earlier'])[0], id: 's1', image: 'https://images.test/stale.jpg' }])
    })

    expect(updateConfig).toHaveBeenCalledTimes(1)
    expect(updateConfig).toHaveBeenCalledWith('panel_music', { playlist: expect.objectContaining({ image: 'https://images.test/s1.jpg' }) }, { history: 'ignore' })
  })
})

// Playing something is what supersedes a song held for Play. The player only
// reports what is playing a moment later, and until it does the held song
// outranks whatever was just started. selectPlaylist was covered first; the
// connected paths that play directly go around it. Found in review.
describe('A song held for Play, when something else is played', () => {
  const song = { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }
  const rain = { id: 'p1', name: 'Rain on Glass', uri: 'spotify:playlist:p1', url: 'https://open.spotify.com/playlist/p1', image: null, owner: 'Someone', trackCount: 40 }

  async function connectedWithASongHeld() {
    session.tokens = userTokens
    const listeners = stubWebPlaybackSdk()
    spotifyApi.spotifyFetch.mockImplementation(async (path: string) => (
      path.startsWith('/playlists/') ? { ...spotifyPlaylistItem, id: 'p1', uri: 'spotify:playlist:p1', name: 'Rain on Glass' } : undefined
    ))
    const { panels } = panelsStub()
    const { result } = await mountSpotifyState(panels)
    await act(async () => {})
    act(() => { listeners.get('ready')?.({ device_id: 'device-1' }) })
    act(() => { result.current.selectTrack(song) })
    expect(result.current.selectedTrack).toEqual(song)
    return result
  }

  it('is dropped when a playlist starts playing', async () => {
    const result = await connectedWithASongHeld()
    await act(async () => { await result.current.playPlaylist(rain, 'panel_music') })
    expect(result.current.selectedTrack).toBeNull()
  })

  it('is dropped when a playlist is loaded from a link', async () => {
    const result = await connectedWithASongHeld()
    await act(async () => { await result.current.loadPlaylistFromUrl('https://open.spotify.com/playlist/p1', 'panel_music') })
    expect(result.current.selectedTrack).toBeNull()
  })

  it('is dropped when a different song starts playing', async () => {
    const result = await connectedWithASongHeld()
    await act(async () => { await result.current.playTrack({ ...song, id: 't2', uri: 'spotify:track:t2', name: 'Another' }, 'panel_music') })
    expect(result.current.selectedTrack).toBeNull()
  })

  // If playing fails the song was not superseded, and is still what Play is for.
  it('is kept when the attempt to play something else fails', async () => {
    const result = await connectedWithASongHeld()
    spotifyApi.spotifyFetch.mockRejectedValue(new Error('Spotify request failed (500).'))

    await act(async () => { await result.current.playPlaylist(rain, 'panel_music').catch(() => {}) })

    expect(result.current.selectedTrack).toEqual(song)
  })
})
