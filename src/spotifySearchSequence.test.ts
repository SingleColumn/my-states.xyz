// @vitest-environment jsdom
//
// Searching while someone types means several answers can be in the air at
// once, and only the newest is still wanted. Which one is allowed to land is
// decided inside useSpotifyState and nowhere else: the panel sees the answer,
// never the race that chose it. So these drive the hook directly, holding
// replies open until a later request has overtaken them. Overtaking within one
// kind of search, and a cleared box, are covered in spotifyAnonymousSearch.test.ts.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
// Imported statically, not from inside a test: this module pulls in tldraw
// and is slow to load, and awaited in the test body that cost lands inside
// the test's own timeout, where a loaded parallel run can exhaust it.
// vi.mock is hoisted above this, so the mocks below still apply.
import { useSpotifyState } from './spotifyState'
import type { PanelsState } from './AppState'

const catalog = vi.hoisted(() => ({
  searchCatalogPlaylists: vi.fn(),
  searchCatalogTracks: vi.fn(),
  fetchCuratedPlaylists: vi.fn(async (_ids: string[]): Promise<unknown[]> => []),
}))

vi.mock('./spotifyCatalog', () => catalog)

const panels = { all: [], get: () => undefined } as unknown as PanelsState

/** A reply this test holds open, to be let go once something has overtaken it. */
function deferred<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => { release = resolve })
  return { promise, release }
}

beforeEach(() => {
  catalog.searchCatalogPlaylists.mockReset()
  catalog.searchCatalogTracks.mockReset()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Spotify search, when answers arrive out of order', () => {
  it('does not let a song search land under a playlist search that followed it', async () => {
    const slow = deferred<unknown>()
    catalog.searchCatalogTracks.mockReturnValueOnce(slow.promise)
    catalog.searchCatalogPlaylists.mockResolvedValueOnce({
      items: [{ id: 'p1', name: 'Playlist Wins', uri: 'spotify:playlist:p1', url: '', image: null, owner: 'Owner', trackCount: 10 }],
      hasMore: false,
    })

    const { result } = renderHook(() => useSpotifyState(null, panels))

    let trackSearch!: Promise<void>
    await act(async () => { trackSearch = result.current.searchTracks('aphex') })
    await act(async () => { await result.current.searchPlaylists('aphex') })

    await act(async () => {
      slow.release({ items: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }] })
      await trackSearch
    })

    expect(result.current.tracks).toEqual([])
    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(['Playlist Wins'])
  })
})
