// @vitest-environment jsdom
//
// The panel searches while someone types, which is behaviour no static render
// can show: the debounce, the two-character floor, what a cleared box does to
// a reply already on its way. Two of these cover bugs found in review after
// the static tests passed, so they are written the way the panel is used —
// type, wait, look — rather than against its internals.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PanelCommands } from '../PanelHeader'
import { PanelCommandsProvider } from '../PanelHeader'
import { SpotifyPanel } from './SpotifyPanel'

const searchDebounceMs = 300

const panel = vi.hoisted(() => ({ focusView: false }))
const spotify = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}))

vi.mock('@posthog/react', () => ({ usePostHog: () => ({ capture: vi.fn() }) }))

vi.mock('../AppState', () => ({
  useAppState: () => ({
    spotify: spotify.state,
    moments: { activeMoment: { id: 'moment_1' } },
    panels: {
      get: () => ({
        id: 'panel_music',
        type: 'spotify',
        focusView: panel.focusView,
        config: { playlist: { id: 'playlist_1', name: 'Deep Focus', uri: 'spotify:playlist:1', url: null, image: null } },
      }),
    },
  }),
}))

const commands: PanelCommands = {
  hidePanel: () => {},
  togglePanelFullScreen: () => {},
  restorePanelDefaultSize: () => {},
  isPanelFullScreen: () => false,
  togglePanelFocusView: () => {},
}

/** A logged-in panel whose search calls are spies, over the results given. */
function mountPanel(overrides: Record<string, unknown> = {}) {
  const searchPlaylists = vi.fn(async () => {})
  const searchTracks = vi.fn(async () => {})
  const clearSearchResults = vi.fn()
  const playPlaylist = vi.fn(async () => {})
  const loadMorePlaylists = vi.fn(async () => {})

  spotify.state = {
    tokens: { accessToken: 'test-token', refreshToken: null, expiresAt: Date.now() + 600_000 },
    track: null,
    tracks: [],
    playlists: [],
    playlistsHaveMore: false,
    deviceId: 'device',
    isReady: true,
    status: 'Ready',
    error: null,
    login: async () => {},
    logout: vi.fn(),
    clearSearchResults,
    handleCallback: async () => {},
    searchPlaylists,
    searchTracks,
    loadMorePlaylists,
    loadPlaylistFromUrl: async () => {},
    playPlaylist,
    playTrack: vi.fn(async () => {}),
    togglePlay: async () => {},
    nextTrack: async () => {},
    previousTrack: async () => {},
    seek: async () => {},
    setVolume: async () => {},
    ...overrides,
  }

  const element = () => createElement(PanelCommandsProvider, {
    commands,
    children: createElement(SpotifyPanel, { panelId: 'panel_music' }),
  })
  const view = render(element())

  // Re-renders the panel that is already mounted, so a change of view or of
  // session is a transition the component lives through rather than a fresh
  // mount that starts every piece of its state again. A new element each
  // time, because React skips a subtree whose element it has seen before.
  const rerender = () => act(() => { view.rerender(element()) })

  return { searchPlaylists, searchTracks, clearSearchResults, playPlaylist, loadMorePlaylists, rerender }
}

function typeSearch(text: string) {
  fireEvent.change(screen.getByLabelText('Search playlists'), { target: { value: text } })
}

/** Let the debounce come due, and the search it fires finish answering. */
async function settle(ms = searchDebounceMs) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

beforeEach(() => {
  panel.focusView = false
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('Music panel search', () => {
  it('searches once for a word, not once per letter', async () => {
    const { searchPlaylists } = mountPanel()

    for (const text of ['ja', 'jaz', 'jazz']) typeSearch(text)
    expect(searchPlaylists).not.toHaveBeenCalled()

    await settle()
    expect(searchPlaylists).toHaveBeenCalledTimes(1)
    expect(searchPlaylists).toHaveBeenCalledWith('jazz')
  })

  it('waits for a second character before asking Spotify anything', async () => {
    const { searchPlaylists, clearSearchResults } = mountPanel()

    typeSearch('j')
    await settle()
    expect(searchPlaylists).not.toHaveBeenCalled()
    expect(clearSearchResults).toHaveBeenCalled()

    typeSearch('ja')
    await settle()
    expect(searchPlaylists).toHaveBeenCalledWith('ja')
  })

  it('searches songs instead when the type is switched', async () => {
    const { searchPlaylists, searchTracks } = mountPanel()

    fireEvent.change(screen.getByLabelText('Search type'), { target: { value: 'tracks' } })
    fireEvent.change(screen.getByLabelText('Search songs'), { target: { value: 'aphex' } })
    await settle()

    expect(searchTracks).toHaveBeenCalledWith('aphex')
    expect(searchPlaylists).not.toHaveBeenCalled()
  })

  // The reply to a search already on its way would otherwise land in the list
  // it was just cleared from, under an empty box. Found in review.
  it('clears the results when the box is emptied', async () => {
    const { clearSearchResults } = mountPanel()

    typeSearch('jazz')
    await settle()
    clearSearchResults.mockClear()

    typeSearch('')
    expect(clearSearchResults).toHaveBeenCalledTimes(1)
  })

  it('does not search for a query that was typed and then withdrawn', async () => {
    const { searchPlaylists } = mountPanel()

    typeSearch('jazz')
    await settle(searchDebounceMs - 50)
    typeSearch('')
    await settle()

    expect(searchPlaylists).not.toHaveBeenCalled()
  })

  it('searches at once when Enter does not want to wait', async () => {
    const { searchPlaylists } = mountPanel()

    typeSearch('techno')
    fireEvent.submit(screen.getByRole('search'))

    expect(searchPlaylists).toHaveBeenCalledWith('techno')
  })

  it('plays the playlist that is chosen from the results', async () => {
    const { playPlaylist } = mountPanel({
      playlists: [{ id: 'p1', name: 'Deep Focus', uri: 'spotify:playlist:1', url: '', image: null, owner: 'Spotify', trackCount: 80 }],
    })

    fireEvent.click(screen.getByText('Deep Focus', { selector: '.playlist-option strong' }))
    expect(playPlaylist).toHaveBeenCalled()
  })

  it('offers more playlists only when Spotify has more to give', async () => {
    const results = [{ id: 'p1', name: 'Deep Focus', uri: 'spotify:playlist:1', url: '', image: null, owner: 'Spotify', trackCount: 80 }]

    mountPanel({ playlists: results, playlistsHaveMore: false })
    typeSearch('jazz')
    await settle()
    expect(screen.queryByText('Show more playlists')).toBeNull()
    cleanup()

    const { loadMorePlaylists } = mountPanel({ playlists: results, playlistsHaveMore: true })
    typeSearch('jazz')
    await settle()
    fireEvent.click(screen.getByText('Show more playlists'))
    expect(loadMorePlaylists).toHaveBeenCalled()
  })

  it('says what it is waiting for, and what it did not find', async () => {
    mountPanel()
    expect(screen.getByText(/Type what you feel like hearing/)).toBeTruthy()

    typeSearch('nothing at all matches this')
    await settle()
    expect(screen.getByText('No playlists match that search.')).toBeTruthy()
  })
})

// The menu entry that opens the link field is absent in the focus view and
// when logged out, and the popover it opens has to go with it. Found in review.
describe('Music panel playlist link', () => {
  function openLinkField() {
    fireEvent.click(screen.getByLabelText('Music panel actions'))
    fireEvent.click(screen.getByText('Play from a Spotify link'))
  }

  it('opens from the panel menu and takes the URL', async () => {
    mountPanel()
    openLinkField()
    expect(screen.getByLabelText('Spotify playlist URL')).toBeTruthy()
  })

  it('goes away with the menu entry when the focus view is chosen', async () => {
    const { rerender } = mountPanel()
    openLinkField()
    expect(screen.getByLabelText('Spotify playlist URL')).toBeTruthy()

    panel.focusView = true
    rerender()

    expect(screen.queryByLabelText('Spotify playlist URL')).toBeNull()
    expect(screen.queryByText('Play from a Spotify link')).toBeNull()
  })

  it('goes away on logging out, rather than offering what needs a session', async () => {
    const { rerender } = mountPanel()
    openLinkField()
    expect(screen.getByLabelText('Spotify playlist URL')).toBeTruthy()

    spotify.state.tokens = null
    rerender()

    expect(screen.queryByLabelText('Spotify playlist URL')).toBeNull()
    expect(screen.getByText('Log in')).toBeTruthy()
  })

  it('does not reopen itself on the next login', async () => {
    const { rerender } = mountPanel()
    openLinkField()

    spotify.state.tokens = null
    rerender()
    spotify.state.tokens = { accessToken: 'test-token', refreshToken: null, expiresAt: Date.now() + 600_000 }
    rerender()

    expect(screen.queryByLabelText('Spotify playlist URL')).toBeNull()
  })

  it('is not offered at all when logged out', async () => {
    mountPanel({ tokens: null })
    expect(screen.queryByLabelText('Search playlists')).toBeNull()
    expect(screen.getByText('Log in')).toBeTruthy()
  })
})
