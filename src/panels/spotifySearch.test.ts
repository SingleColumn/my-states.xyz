// @vitest-environment jsdom
//
// The panel searches while someone types, which is behaviour no static render
// can show: the debounce, the two-character floor, what a cleared box does to
// a reply already on its way. Two of these cover bugs found in review after
// the static tests passed, so they are written the way the panel is used —
// type, wait, look — rather than against its internals.
//
// The same field now serves someone who has not connected Spotify, so the
// second half of this file drives the panel with no session at all: the
// search still works, and choosing a playlist still only chooses it.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode, createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PanelCommands } from '../PanelHeader'
import { PanelCommandsProvider } from '../PanelHeader'
import { SpotifyPanel } from './SpotifyPanel'

const searchDebounceMs = 300

type PanelPlaylist = { id: string | null; name: string | null; uri: string | null; url: string | null; image: string | null }
const panel = vi.hoisted(() => ({ focusView: false, momentId: 'moment_1', playlist: null as unknown as PanelPlaylist }))
const spotify = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}))

// The curated pool is empty in this repository, so a test that wants
// suggestions supplies its own. Set before mounting: the panel reads the
// session's choice once, which is the whole point of keeping it in a module.
const curated = vi.hoisted(() => ({
  entries: [] as Array<{ id: string; category?: string }>,
  shuffled: [] as Array<{ id: string; category?: string }>,
  summaries: [] as Array<Record<string, unknown>>,
  failLookup: false,
}))

vi.mock('@posthog/react', () => ({ usePostHog: () => ({ capture: vi.fn() }) }))

vi.mock('../spotifySuggestions', () => ({
  getSessionSuggestions: () => curated.entries,
  shuffleSessionSuggestions: () => {
    curated.entries = curated.shuffled
    return curated.shuffled
  },
  suggestionCount: 6,
}))

vi.mock('../spotifyCatalog', () => ({
  fetchCuratedPlaylists: async (ids: string[]) => {
    if (curated.failLookup) throw new Error('discovery down')
    return curated.summaries.filter((summary) => ids.includes(summary.id as string))
  },
}))

vi.mock('../AppState', () => ({
  useAppState: () => ({
    spotify: spotify.state,
    moments: { activeMoment: { id: panel.momentId } },
    panels: {
      get: () => ({
        id: 'panel_music',
        type: 'spotify',
        focusView: panel.focusView,
        config: { playlist: panel.playlist },
      }),
    },
  }),
}))

const commands: PanelCommands = {
  hidePanel: () => {},
  deletePanel: () => {},
  togglePanelFullScreen: () => {},
  restorePanelDefaultSize: () => {},
  isPanelFullScreen: () => false,
  togglePanelFocusView: () => {},
  expandPanelFromStartingHeight: () => {},
}

/** A connected panel whose search calls are spies, over the results given. */
function mountPanel(overrides: Record<string, unknown> = {}, options: { strict?: boolean } = {}) {
  const searchPlaylists = vi.fn(async () => {})
  const searchTracks = vi.fn(async () => {})
  const clearSearchResults = vi.fn()
  const playPlaylist = vi.fn(async () => {})
  const playTrack = vi.fn(async () => {})
  // As in the app, choosing a playlist writes it into the moment's panel.
  const selectPlaylist = vi.fn((summary: { id: string; name: string; uri: string; url: string; image: string | null }) => {
    panel.playlist = { id: summary.id, name: summary.name, uri: summary.uri, url: summary.url, image: summary.image }
  })
  // As in the app, a chosen song is held until it is played.
  const selectTrack = vi.fn((track: unknown) => { spotify.state.selectedTrack = track })
  const login = vi.fn(async () => {})
  const loadMorePlaylists = vi.fn(async () => {})
  const togglePlay = vi.fn(async () => {})
  const lookupTrack = vi.fn(async () => {})

  spotify.state = {
    tokens: { accessToken: 'test-token', refreshToken: null, expiresAt: Date.now() + 600_000 },
    track: null,
    tracks: [],
    playlists: [],
    selectedTrack: null,
    playlistsHaveMore: false,
    deviceId: 'device',
    isReady: true,
    status: 'Ready',
    error: null,
    login,
    logout: vi.fn(),
    clearSearchResults,
    handleCallback: async () => {},
    searchPlaylists,
    searchTracks,
    loadMorePlaylists,
    loadPlaylistFromUrl: async () => {},
    selectPlaylist,
    selectTrack,
    lookupTrack,
    playPlaylist,
    playTrack,
    togglePlay,
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
  // The app mounts everything in React.StrictMode, which in development runs
  // every effect twice. A test that means to see what the app does asks for it.
  const view = render(element(), options.strict ? { wrapper: StrictMode } : undefined)

  // Re-renders the panel that is already mounted, so a change of view or of
  // session is a transition the component lives through rather than a fresh
  // mount that starts every piece of its state again. A new element each
  // time, because React skips a subtree whose element it has seen before.
  const rerender = () => act(() => { view.rerender(element()) })

  return { searchPlaylists, searchTracks, clearSearchResults, playPlaylist, playTrack, selectPlaylist, selectTrack, login, loadMorePlaylists, togglePlay, lookupTrack, rerender }
}

/** The same panel with no Spotify session: what a first-time visitor sees. */
function mountAnonymousPanel(overrides: Record<string, unknown> = {}, options: { strict?: boolean } = {}) {
  return mountPanel({ tokens: null, ...overrides }, options)
}

/** What the search looks for is a setting in the panel's ··· menu, not a control in the body. */
function chooseSearchType(type: 'playlists' | 'tracks') {
  fireEvent.click(screen.getByLabelText('Music panel actions'))
  fireEvent.click(screen.getByText(type === 'tracks' ? 'Search for songs' : 'Search for playlists'))
}

function typeSearch(text: string) {
  fireEvent.change(screen.getByLabelText('Search playlists'), { target: { value: text } })
}

/** Let the debounce come due, and the search it fires finish answering. */
async function settle(ms = searchDebounceMs) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

/** Let the suggestion lookup, which is a promise and not a timer, resolve. */
async function settleSuggestions() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

const deepFocus: PanelPlaylist = { id: 'playlist_1', name: 'Deep Focus', uri: 'spotify:playlist:1', url: null, image: null }
const nothingChosen: PanelPlaylist = { id: null, name: null, uri: null, url: null, image: null }

beforeEach(() => {
  panel.focusView = false
  panel.momentId = 'moment_1'
  panel.playlist = { ...deepFocus }
  curated.entries = []
  curated.shuffled = []
  curated.summaries = []
  curated.failLookup = false
  window.sessionStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

const rainResult = { id: 'p1', name: 'Rain on Glass', uri: 'spotify:playlist:p1', url: '', image: null, owner: 'Someone', trackCount: 40 }

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

    chooseSearchType('tracks')
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

  // Someone who has connected Spotify asked for music by clicking, and gets it:
  // this is the behaviour the panel had before anonymous browsing, and the
  // only thing that differs for a visitor who has not connected is that there
  // is nothing to play with yet.
  it('plays the playlist that is clicked, when Spotify is connected', async () => {
    const { selectPlaylist, playPlaylist } = mountPanel({
      playlists: [{ id: 'p1', name: 'Deep Focus', uri: 'spotify:playlist:1', url: '', image: null, owner: 'Spotify', trackCount: 80 }],
    })

    fireEvent.click(screen.getByText('Deep Focus', { selector: '.playlist-option strong' }))
    expect(playPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'panel_music')
    expect(selectPlaylist).not.toHaveBeenCalled()
  })

  it('plays the song that is clicked, when Spotify is connected', async () => {
    const { playTrack, selectTrack } = mountPanel({
      tracks: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }],
    })

    chooseSearchType('tracks')
    fireEvent.click(screen.getByText('Xtal', { selector: '.playlist-option strong' }))
    expect(playTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'panel_music')
    expect(selectTrack).not.toHaveBeenCalled()
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

  it('says nothing under an empty box when searching for songs either', () => {
    mountPanel()
    chooseSearchType('tracks')

    expect(document.querySelector('.playlist-list-note')).toBeNull()
    expect(screen.queryByText(/type a song name/i)).toBeNull()
  })

  // An empty box needs no instruction: the field already says what it searches
  // for. Only a search that came back empty has anything to say.
  it('says nothing under an empty box, and says what it did not find', async () => {
    mountPanel()
    expect(document.querySelector('.playlist-list-note')).toBeNull()
    expect(screen.queryByText(/feel like hearing/i)).toBeNull()

    typeSearch('nothing at all matches this')
    await settle()
    expect(screen.getByText('No playlists match that search.')).toBeTruthy()
  })
})

// The menu entry that opens the link field is absent in the focus view and
// when not connected, and the popover it opens has to go with it. Found in review.
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
    expect(screen.getByText('Connect Spotify')).toBeTruthy()
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

  it('is not offered at all before Spotify is connected', async () => {
    mountAnonymousPanel()
    expect(screen.queryByText('Play from a Spotify link')).toBeNull()
    expect(screen.queryByLabelText('Spotify playlist URL')).toBeNull()
  })
})

// The moment saves a playlist so that it is there to play when the panel is
// connected. Until then it is a name that cannot be played and that this
// visitor did not just choose, so it is kept out of sight rather than left to
// raise a question with no good answer.
describe('Music panel and the playlist saved in the moment', () => {
  const footerName = () => document.querySelector('.card-footer-meta')?.textContent

  it('does not show it before Spotify is connected', () => {
    mountAnonymousPanel()

    expect(document.querySelector('.loaded-playlist')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('Deep Focus')).toBeNull()
    expect(footerName()).toBe('No playlist loaded')
  })

  it('does not mark it among the results either', () => {
    mountAnonymousPanel({ playlists: [{ ...rainResult, id: 'playlist_1', name: 'Deep Focus' }, rainResult] })

    const saved = screen.getByText('Deep Focus', { selector: '.playlist-option strong' }).closest('button')
    expect(saved?.classList.contains('is-current')).toBe(false)
  })

  it('shows a playlist once it is chosen now', () => {
    mountAnonymousPanel({ playlists: [rainResult] })

    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

    expect(document.querySelector('.loaded-playlist')?.textContent).toContain('Rain on Glass')
    expect(screen.getByRole('status').textContent).toContain('Connect Spotify to play this playlist here')
    expect(footerName()).toBe('Rain on Glass')
  })

  // Choosing a song is a step towards a playlist and not a choice of the saved
  // one, so it must not bring the saved one back into view.
  it('stays out of sight when a song is chosen', () => {
    mountAnonymousPanel({
      tracks: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }],
    })
    chooseSearchType('tracks')
    fireEvent.click(screen.getByText('Xtal', { selector: '.playlist-option strong' }))

    expect(document.querySelector('.loaded-playlist')).toBeNull()
    expect(screen.queryByText('Deep Focus')).toBeNull()
  })

  it('is shown as ever once connected, with no explanation attached', () => {
    mountPanel()

    expect(document.querySelector('.loaded-playlist')?.textContent).toContain('Deep Focus')
    expect(footerName()).toBe('Deep Focus')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('appears when Spotify gets connected, since it is theirs to play now', () => {
    const { rerender } = mountAnonymousPanel()
    expect(document.querySelector('.loaded-playlist')).toBeNull()

    spotify.state.tokens = { accessToken: 'test-token', refreshToken: null, expiresAt: Date.now() + 600_000 }
    rerender()

    expect(document.querySelector('.loaded-playlist')?.textContent).toContain('Deep Focus')
  })

  it('goes out of sight again if Spotify is disconnected', () => {
    const { rerender } = mountPanel()
    expect(document.querySelector('.loaded-playlist')).not.toBeNull()

    spotify.state.tokens = null
    rerender()

    expect(document.querySelector('.loaded-playlist')).toBeNull()
  })

  it('forgets what was chosen when another moment is opened', () => {
    const { rerender } = mountAnonymousPanel({ playlists: [rainResult] })
    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))
    expect(document.querySelector('.loaded-playlist')).not.toBeNull()

    panel.momentId = 'moment_2'
    panel.playlist = { id: 'other', name: 'Saved Elsewhere', uri: 'spotify:playlist:other', url: null, image: null }
    rerender()

    expect(document.querySelector('.loaded-playlist')).toBeNull()
    expect(screen.queryByText('Saved Elsewhere')).toBeNull()
  })

  it('stays after the fields are reset, since the choice was made', () => {
    mountAnonymousPanel({ playlists: [rainResult] })
    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

    fireEvent.click(screen.getByText('Reset fields'))

    expect(document.querySelector('.loaded-playlist')?.textContent).toContain('Rain on Glass')
  })
})

describe('Music panel before Spotify is connected', () => {
  it('opens on the search and an offer to connect, not on a login wall', () => {
    mountAnonymousPanel()

    expect(screen.getByLabelText('Search playlists')).toBeTruthy()
    expect(screen.getByText('Connect Spotify')).toBeTruthy()
    // The card that used to be the whole body when logged out.
    expect(screen.queryByText('Play a playlist')).toBeNull()
    expect(screen.queryByText('Log in')).toBeNull()
  })

  it('offers connecting without anything having to be chosen first', () => {
    const { login } = mountAnonymousPanel()
    fireEvent.click(screen.getByText('Connect Spotify'))
    expect(login).toHaveBeenCalled()
  })

  it('searches the catalog with no Spotify session, on the same debounce', async () => {
    const { searchPlaylists } = mountAnonymousPanel()

    for (const text of ['ja', 'jaz', 'jazz']) typeSearch(text)
    expect(searchPlaylists).not.toHaveBeenCalled()

    await settle()
    expect(searchPlaylists).toHaveBeenCalledTimes(1)
    expect(searchPlaylists).toHaveBeenCalledWith('jazz')
  })

  it('holds its fire below the two-character floor, and clears on an empty box', async () => {
    const { searchPlaylists, clearSearchResults } = mountAnonymousPanel()

    typeSearch('j')
    await settle()
    expect(searchPlaylists).not.toHaveBeenCalled()
    expect(clearSearchResults).toHaveBeenCalled()

    typeSearch('jazz')
    await settle()
    clearSearchResults.mockClear()
    typeSearch('')
    expect(clearSearchResults).toHaveBeenCalledTimes(1)
  })

  it('searches songs as well, when the type is switched', async () => {
    const { searchTracks } = mountAnonymousPanel()

    chooseSearchType('tracks')
    fireEvent.change(screen.getByLabelText('Search songs'), { target: { value: 'aphex' } })
    await settle()

    expect(searchTracks).toHaveBeenCalledWith('aphex')
  })

  // The one thing a click on a result must never be is a disguised login
  // button. It chooses the playlist and stops there.
  it('chooses a playlist without starting Spotify login or playback', async () => {
    const { selectPlaylist, login, playPlaylist } = mountAnonymousPanel({
      playlists: [{ id: 'p1', name: 'Rain on Glass', uri: 'spotify:playlist:p1', url: '', image: null, owner: 'Someone', trackCount: 40 }],
    })

    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

    expect(selectPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'panel_music')
    expect(login).not.toHaveBeenCalled()
    expect(playPlaylist).not.toHaveBeenCalled()
  })

  it('chooses a song without trying to play it', async () => {
    const { selectTrack, playTrack, login } = mountAnonymousPanel({
      tracks: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }],
    })

    chooseSearchType('tracks')
    fireEvent.click(screen.getByText('Xtal', { selector: '.playlist-option strong' }))

    expect(selectTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    expect(playTrack).not.toHaveBeenCalled()
    expect(login).not.toHaveBeenCalled()
  })

  // There is one way to connect Spotify, and it is the same button whether or
  // not something has been chosen. It leaves crumbs to come back to.
  it('remembers the search and the choice when Spotify is connected, so it can come back to them', () => {
    const { login } = mountAnonymousPanel({ playlists: [rainResult] })
    typeSearch('rain')
    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }))

    expect(login).toHaveBeenCalled()
    expect(JSON.parse(window.sessionStorage.getItem('mic:spotify-return-context') ?? 'null')).toEqual({
      panelId: 'panel_music',
      momentId: 'moment_1',
      choice: { kind: 'playlist', spotifyId: 'p1' },
      query: 'rain',
      searchType: 'playlists',
    })
  })

  // What the visitor cannot see, they did not choose: a playlist saved in the
  // moment is not carried across the redirect as if it were theirs.
  it('does not remember a playlist that was only saved in the moment', () => {
    mountAnonymousPanel()
    typeSearch('rain')

    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }))

    expect(JSON.parse(window.sessionStorage.getItem('mic:spotify-return-context') ?? 'null')).toMatchObject({
      choice: null,
      query: 'rain',
    })
  })

  it('remembers the search even when nothing has been chosen yet', () => {
    panel.playlist = { ...nothingChosen }
    mountAnonymousPanel()
    typeSearch('rain')

    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }))

    expect(JSON.parse(window.sessionStorage.getItem('mic:spotify-return-context') ?? 'null')).toMatchObject({
      choice: null,
      query: 'rain',
    })
  })

  // Found in review: a sign-in cancelled at Spotify never reads its context. If
  // the visitor then clears everything and connects again, the old context
  // must not wait for that login and restore a song they had cleared.
  it('throws away a context left by an abandoned attempt when there is nothing to come back to', () => {
    window.sessionStorage.setItem('mic:spotify-return-context', JSON.stringify({
      panelId: 'panel_music',
      choice: { kind: 'track', spotifyId: 't-stale' },
      query: 'stale search',
      searchType: 'tracks',
    }))
    panel.playlist = { ...nothingChosen }
    const { login } = mountAnonymousPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }))

    expect(login).toHaveBeenCalled()
    expect(window.sessionStorage.getItem('mic:spotify-return-context')).toBeNull()
  })

  it('replaces a context left by an abandoned attempt with the current one', () => {
    window.sessionStorage.setItem('mic:spotify-return-context', JSON.stringify({
      panelId: 'panel_music',
      choice: { kind: 'track', spotifyId: 't-stale' },
      query: 'stale search',
      searchType: 'tracks',
    }))
    panel.playlist = { ...nothingChosen }
    mountAnonymousPanel()
    typeSearch('rain')

    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }))

    expect(JSON.parse(window.sessionStorage.getItem('mic:spotify-return-context') ?? 'null')).toEqual({
      panelId: 'panel_music',
      momentId: 'moment_1',
      choice: null,
      query: 'rain',
      searchType: 'playlists',
    })
  })

  it('leaves nothing behind when there is nothing to come back to', () => {
    panel.playlist = { ...nothingChosen }
    mountAnonymousPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }))

    expect(window.sessionStorage.getItem('mic:spotify-return-context')).toBeNull()
  })

  // A dropdown beside the field made it the narrower half of its row, and was
  // one more thing to decide before typing. What the search looks for is a
  // setting, so it moves to the panel menu and the field takes the whole row.
  it('has no search-type dropdown in the body, and puts the choice in the panel menu', () => {
    mountAnonymousPanel()
    expect(screen.queryByLabelText('Search type')).toBeNull()
    expect(document.querySelector('.panel-body select')).toBeNull()

    fireEvent.click(screen.getByLabelText('Music panel actions'))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Search for playlists' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Search for songs' }).getAttribute('aria-checked')).toBe('false')
  })

  it('switches what the field searches for from the menu, and says so in the field', () => {
    mountAnonymousPanel()
    expect(screen.getByLabelText('Search playlists')).toBeTruthy()

    chooseSearchType('tracks')
    expect(screen.getByLabelText('Search songs')).toBeTruthy()
    expect(screen.queryByLabelText('Search playlists')).toBeNull()

    fireEvent.click(screen.getByLabelText('Music panel actions'))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Search for songs' }).getAttribute('aria-checked')).toBe('true')
  })

  // The glow follows a click, not a state. A playlist saved in the moment days
  // ago is not news, and a button that glows at every visit is only noise.
  describe('the glow on Connect Spotify', () => {
    const rain = { id: 'p1', name: 'Rain on Glass', uri: 'spotify:playlist:p1', url: '', image: null, owner: 'Someone', trackCount: 40 }
    const connectButton = () => screen.getByRole('button', { name: 'Connect Spotify' })
    const glows = () => connectButton().classList.contains('is-inviting')

    it('is not there for a playlist that was already saved, however it got there', () => {
      mountAnonymousPanel()
      expect(glows()).toBe(false)
    })

    it('starts when a search result is clicked', () => {
      mountAnonymousPanel({ playlists: [rain] })
      expect(glows()).toBe(false)

      fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))
      expect(glows()).toBe(true)
    })

    it('starts when a song is clicked', () => {
      mountAnonymousPanel({
        tracks: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }],
      })
      chooseSearchType('tracks')
      expect(glows()).toBe(false)

      fireEvent.click(screen.getByText('Xtal', { selector: '.playlist-option strong' }))
      expect(glows()).toBe(true)
    })

    // A new element, because that is what makes the animation begin again.
    it('starts over on the next click', () => {
      mountAnonymousPanel({ playlists: [rain] })
      const row = () => screen.getByText('Rain on Glass', { selector: '.playlist-option strong' })

      fireEvent.click(row())
      const first = connectButton()
      fireEvent.click(row())

      expect(glows()).toBe(true)
      expect(connectButton()).not.toBe(first)
    })

    it('stops when the fields are reset', () => {
      mountAnonymousPanel({ playlists: [rain] })
      fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))
      expect(glows()).toBe(true)

      fireEvent.click(screen.getByText('Reset fields'))
      expect(glows()).toBe(false)
    })

    it('is not there once Spotify is connected, when there is nothing to connect', () => {
      mountPanel({ playlists: [rain] })
      expect(screen.queryByRole('button', { name: 'Connect Spotify' })).toBeNull()
    })

    // A click made before connecting must not come back as a glow after a
    // log-out, for a choice that is long since settled.
    it('does not come back after connecting and logging out again', () => {
      const { rerender } = mountAnonymousPanel({ playlists: [rain] })
      fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))
      expect(glows()).toBe(true)

      spotify.state.tokens = { accessToken: 'test-token', refreshToken: null, expiresAt: Date.now() + 600_000 }
      rerender()
      spotify.state.tokens = null
      rerender()

      expect(glows()).toBe(false)
    })
  })

  it('has no Connect Spotify to draw attention to once connected', () => {
    mountPanel()
    expect(screen.queryByRole('button', { name: 'Connect Spotify' })).toBeNull()
  })

  it('keeps the search visible: there is no player to reveal by hiding it', () => {
    mountAnonymousPanel()
    expect(screen.queryByText('Hide search')).toBeNull()
    expect(screen.getByLabelText('Search playlists')).toBeTruthy()
  })

  // A click that appears to do nothing reads as broken, so the chosen playlist
  // is answered in words: why it is not playing, and that the way back is
  // handled. Words, not a second button.
  it('explains a chosen playlist in a line of text', () => {
    mountAnonymousPanel({ playlists: [rainResult] })
    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

    const note = screen.getByRole('status')
    expect(note.textContent).toContain('Connect Spotify to play this playlist here')
    expect(note.textContent).toContain('come straight back to this page')
    expect(note.querySelector('button, a')).toBeNull()
  })

  it('explains a chosen song the same way, naming it', () => {
    mountAnonymousPanel({
      selectedTrack: { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: 'https://open.spotify.com/track/t1', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 },
    })

    const note = screen.getByRole('status')
    expect(note.textContent).toContain('Xtal')
    expect(note.textContent).toContain('Connect Spotify to play this song here')
  })

  // Two buttons that look alike and do the same thing is a design fault, so
  // there is exactly one way to connect Spotify in the panel, chosen or not.
  it('has one Connect Spotify button, whether or not something is chosen', () => {
    mountAnonymousPanel()
    expect(screen.getAllByRole('button', { name: /connect spotify/i })).toHaveLength(1)
    cleanup()

    mountAnonymousPanel({
      selectedTrack: { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: 'https://open.spotify.com/track/t1', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 },
    })
    expect(screen.getAllByRole('button', { name: /connect spotify/i })).toHaveLength(1)
  })

  // Connecting is the only redirect to Spotify, because it is the only one
  // that brings the visitor back. A link out that leaves them stranded is not
  // offered, even for a song that has an address to link to.
  it('never offers a way out of the app to Spotify', () => {
    mountAnonymousPanel({
      selectedTrack: { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: 'https://open.spotify.com/track/t1', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 },
    })

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/open (it )?in spotify/i)).toBeNull()
    expect(document.querySelector('a[href*="open.spotify.com"]')).toBeNull()
  })
})

// Coming back from Spotify with something chosen. Nothing plays by itself --
// a browser will not start sound without a click -- so the panel says so, and
// the player's own Play button is the one to press: no second Play beside it.
describe('Music panel on returning from connecting Spotify', () => {
  function leaveAnIntent(kind: 'playlist' | 'track' = 'playlist', extra: { query?: string; searchType?: 'playlists' | 'tracks'; panelId?: string; momentId?: string | null } = {}) {
    window.sessionStorage.setItem('mic:spotify-return-context', JSON.stringify({
      panelId: extra.panelId ?? 'panel_music',
      ...(extra.momentId === null ? {} : { momentId: extra.momentId ?? 'moment_1' }),
      choice: { kind, spotifyId: kind === 'track' ? 't1' : 'playlist_1' },
      query: extra.query ?? '',
      searchType: extra.searchType ?? 'playlists',
    }))
  }

  it('says the account is connected and how to start, and does not start anything itself', async () => {
    leaveAnIntent()
    const { playPlaylist, togglePlay } = mountPanel()
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('status').textContent).toContain('Spotify is connected. Press play to start Deep Focus.')
    expect(playPlaylist).not.toHaveBeenCalled()
    expect(togglePlay).not.toHaveBeenCalled()
  })

  it('starts the chosen playlist when the player\'s Play is pressed', async () => {
    leaveAnIntent()
    const { togglePlay } = mountPanel()
    await act(async () => { await Promise.resolve() })

    fireEvent.click(screen.getByTitle('Play or pause'))
    expect(togglePlay).toHaveBeenCalledWith('panel_music')
  })

  // A song is only ever a runtime choice, so it is looked up again after the
  // redirect, and it is the song -- not the panel's saved playlist -- that the
  // same Play button then starts.
  it('looks the chosen song up again, and Play starts the song', async () => {
    leaveAnIntent('track')
    const song = { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }
    const { playTrack, togglePlay, lookupTrack } = mountPanel({ selectedTrack: song })
    await act(async () => { await Promise.resolve() })

    expect(lookupTrack).toHaveBeenCalledWith('t1')
    fireEvent.click(screen.getByTitle('Play or pause'))
    expect(playTrack).toHaveBeenCalledWith(song, 'panel_music')
    expect(togglePlay).not.toHaveBeenCalled()
  })

  it('says so while Spotify\'s player is still getting ready', async () => {
    leaveAnIntent()
    mountPanel({ isReady: false })
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('status').textContent).toContain('Getting it ready to play')
  })

  it('adds no second Play button beside the player\'s', async () => {
    leaveAnIntent()
    mountPanel()
    await act(async () => { await Promise.resolve() })

    expect(screen.getAllByTitle('Play or pause')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
  })

  // The redirect wipes everything the panel held in memory, so arriving to an
  // empty box left no sign of whether the playlist was still chosen. The words
  // come back, the search runs again, and the chosen playlist is marked in it.
  it('brings the search back and runs it again', async () => {
    leaveAnIntent('playlist', { query: 'rain' })
    const { searchPlaylists } = mountPanel()
    await act(async () => { await Promise.resolve() })

    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('rain')
    await settle()
    expect(searchPlaylists).toHaveBeenCalledWith('rain')
  })

  it('brings back a song search as a song search', async () => {
    leaveAnIntent('track', { query: 'xtal', searchType: 'tracks' })
    const { searchTracks, searchPlaylists } = mountPanel()
    await act(async () => { await Promise.resolve() })

    expect((screen.getByLabelText('Search songs') as HTMLInputElement).value).toBe('xtal')
    await settle()
    expect(searchTracks).toHaveBeenCalledWith('xtal')
    expect(searchPlaylists).not.toHaveBeenCalled()
  })

  it('marks the chosen playlist among the restored results', async () => {
    leaveAnIntent('playlist', { query: 'focus' })
    mountPanel({
      playlists: [
        { id: 'other', name: 'Something Else', uri: 'spotify:playlist:o', url: '', image: null, owner: 'Someone', trackCount: 10 },
        { id: 'playlist_1', name: 'Deep Focus', uri: 'spotify:playlist:1', url: '', image: null, owner: 'Spotify', trackCount: 80 },
      ],
    })
    await act(async () => { await Promise.resolve() })
    await settle()

    const chosen = screen.getByText('Deep Focus', { selector: '.playlist-option strong' }).closest('button')
    const other = screen.getByText('Something Else', { selector: '.playlist-option strong' }).closest('button')
    expect(chosen?.classList.contains('is-current')).toBe(true)
    expect(other?.classList.contains('is-current')).toBe(false)
  })

  it('restores the search even when nothing had been chosen, without a Press-play prompt', async () => {
    window.sessionStorage.setItem('mic:spotify-return-context', JSON.stringify({ panelId: 'panel_music', choice: null, query: 'rain', searchType: 'playlists' }))
    panel.playlist = { ...nothingChosen }
    const { searchPlaylists } = mountPanel()
    await act(async () => { await Promise.resolve() })
    await settle()

    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('rain')
    expect(searchPlaylists).toHaveBeenCalledWith('rain')
    expect(screen.queryByRole('status')).toBeNull()
  })

  // Found in review: the page that comes back opens whichever moment is active
  // in storage shared by every tab, and another tab may have opened a different
  // one while this tab was at Spotify. What this tab saved is for the panel and
  // moment it was saved in, and for no other.
  describe('when the page comes back to a different panel or moment', () => {
    it('restores into the panel and moment it was saved for', async () => {
      leaveAnIntent('playlist', { query: 'rain', momentId: 'moment_1' })
      mountPanel()
      await act(async () => { await Promise.resolve() })

      expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('rain')
      expect(screen.getByRole('status').textContent).toContain('Press play to start')
    })

    it('does not restore into a different moment', async () => {
      leaveAnIntent('track', { query: 'rain', momentId: 'moment_elsewhere' })
      const { lookupTrack } = mountPanel()
      await act(async () => { await Promise.resolve() })

      expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('')
      expect(screen.queryByRole('status')).toBeNull()
      expect(lookupTrack).not.toHaveBeenCalled()
    })

    it('does not restore into a different panel', async () => {
      leaveAnIntent('track', { query: 'rain', panelId: 'panel_other' })
      const { lookupTrack } = mountPanel()
      await act(async () => { await Promise.resolve() })

      expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('')
      expect(screen.queryByRole('status')).toBeNull()
      expect(lookupTrack).not.toHaveBeenCalled()
    })

    it('still restores a context written without a moment, for the panel it names', async () => {
      leaveAnIntent('playlist', { query: 'rain', momentId: null })
      mountPanel()
      await act(async () => { await Promise.resolve() })

      expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('rain')
    })

    // It has been taken either way: a second panel mounting later must not find it.
    it('uses the context up whether or not it was restored', async () => {
      leaveAnIntent('track', { query: 'rain', momentId: 'moment_elsewhere' })
      mountPanel()
      await act(async () => { await Promise.resolve() })

      expect(window.sessionStorage.getItem('mic:spotify-return-context')).toBeNull()
    })
  })

  // Found in review: until the song has been looked up again there is nothing to
  // play it with, and the panel fell back to the moment's saved playlist -- named
  // it, and started it on Play -- when the visitor had asked for a song.
  describe('while the song they chose is being looked up again', () => {
    const song = { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }

    function slowLookup() {
      let release!: () => void
      const held = new Promise<void>((resolve) => { release = resolve })
      const lookupTrack = vi.fn(() => held.then(() => { spotify.state.selectedTrack = song }))
      return { lookupTrack, release }
    }
    const playButton = () => screen.getByTitle('Play or pause') as HTMLButtonElement

    it('says so, and does not name the saved playlist as what will play', async () => {
      leaveAnIntent('track')
      const { lookupTrack } = slowLookup()
      mountPanel({ lookupTrack })
      await act(async () => { await Promise.resolve() })

      const status = screen.getByRole('status').textContent ?? ''
      expect(status).toContain('Getting the song you chose ready')
      expect(status).not.toContain('Deep Focus')
      expect(status).not.toContain('Press play')
    })

    it('holds Play back, so it cannot start the saved playlist in the meantime', async () => {
      leaveAnIntent('track')
      const { lookupTrack } = slowLookup()
      const { togglePlay } = mountPanel({ lookupTrack })
      await act(async () => { await Promise.resolve() })

      expect(playButton().disabled).toBe(true)
      fireEvent.click(playButton())
      expect(togglePlay).not.toHaveBeenCalled()
    })

    it('offers the song once it is found, and lets Play start it', async () => {
      leaveAnIntent('track')
      const { lookupTrack, release } = slowLookup()
      const { playTrack, togglePlay } = mountPanel({ lookupTrack })
      await act(async () => { await Promise.resolve() })

      await act(async () => { release(); await Promise.resolve(); await Promise.resolve() })

      expect(screen.getByRole('status').textContent).toContain('Press play to start Xtal')
      expect(playButton().disabled).toBe(false)
      fireEvent.click(playButton())
      expect(playTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'panel_music')
      expect(togglePlay).not.toHaveBeenCalled()
    })

    // The song is gone either way; what matters is that Play is not left dead.
    it('gives Play back, with the error shown, if the song cannot be found', async () => {
      leaveAnIntent('track')
      const lookupTrack = vi.fn(async () => { throw new Error('Spotify request failed (404).') })
      mountPanel({ lookupTrack })
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

      expect(playButton().disabled).toBe(false)
      expect(document.querySelector('.card-footer .error-text')?.textContent).toContain('404')
    })

    it('does not hold Play back for a playlist, which needs no lookup', async () => {
      leaveAnIntent('playlist')
      mountPanel()
      await act(async () => { await Promise.resolve() })

      expect(playButton().disabled).toBe(false)
    })
  })

  // Found in review: the prompt is about what was chosen before leaving for
  // Spotify, in the moment it was chosen in. Another moment must not show it
  // beside its own saved playlist, for music nobody picked there.
  it('stops saying "press play" when another moment is opened', async () => {
    leaveAnIntent('playlist')
    const { rerender } = mountPanel()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('status').textContent).toContain('Press play to start')

    panel.momentId = 'moment_2'
    rerender()

    expect(screen.queryByRole('status')).toBeNull()
  })

  // A song just started stays what Play is for until the player reports it, so a
  // second press in that gap asks for the same song again and never falls to the
  // saved playlist. Found in review.
  it('starts the song again, not the saved playlist, when Play is pressed twice before the player reports', async () => {
    const song = { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }
    leaveAnIntent('track')
    const { playTrack, togglePlay } = mountPanel({ selectedTrack: song, lookupTrack: vi.fn(async () => {}) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    fireEvent.click(screen.getByTitle('Play or pause'))
    fireEvent.click(screen.getByTitle('Play or pause'))

    expect(playTrack).toHaveBeenCalledTimes(2)
    expect(playTrack).toHaveBeenNthCalledWith(2, song, 'panel_music')
    expect(togglePlay).not.toHaveBeenCalled()
  })

  it('lets the held song go once the player reports what is playing', async () => {
    const song = { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }
    const { rerender, selectTrack } = mountPanel({ selectedTrack: song })
    await act(async () => { await Promise.resolve() })
    expect(selectTrack).not.toHaveBeenCalledWith(null)

    spotify.state.track = { title: 'Xtal', artist: 'Aphex Twin', album: 'SAW 85-92', albumArt: null, url: null, durationMs: 1000, positionMs: 0, paused: false }
    rerender()

    expect(selectTrack).toHaveBeenCalledWith(null)
  })

  // The same double run of effects, on the way back from a sign-in that worked:
  // the prompt and the wait for the song were reset by it in development.
  describe('when React runs the effects twice, as it does in development', () => {
    it('still says to press play', async () => {
      leaveAnIntent('playlist')
      mountPanel({}, { strict: true })
      await act(async () => { await Promise.resolve() })

      expect(screen.getByRole('status').textContent).toContain('Press play to start Deep Focus')
    })

    it('still holds Play back while the song is looked up', async () => {
      leaveAnIntent('track')
      let release!: () => void
      const held = new Promise<void>((resolve) => { release = resolve })
      const lookupTrack = vi.fn(() => held)
      mountPanel({ lookupTrack }, { strict: true })
      await act(async () => { await Promise.resolve() })

      expect(screen.getByRole('status').textContent).toContain('Getting the song you chose ready')
      expect((screen.getByTitle('Play or pause') as HTMLButtonElement).disabled).toBe(true)
      await act(async () => { release(); await Promise.resolve(); await Promise.resolve() })
    })
  })

  it('is not shown to someone who was connected already and left nothing behind', async () => {
    mountPanel()
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('goes away once something is playing', async () => {
    leaveAnIntent()
    const { rerender } = mountPanel()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('status')).toBeTruthy()

    spotify.state.track = { title: 'Weightless', artist: 'Marconi Union', album: 'Distance', albumArt: null, url: null, durationMs: 8000, positionMs: 0, paused: false }
    rerender()

    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('Music panel suggestions', () => {
  const summaries = Array.from({ length: 6 }, (_, index) => ({
    id: `s${index}`,
    name: `Suggestion ${index}`,
    uri: `spotify:playlist:s${index}`,
    url: `https://open.spotify.com/playlist/s${index}`,
    image: null,
    owner: 'Someone',
    trackCount: 30,
  }))

  function withSuggestions() {
    curated.entries = summaries.map((summary) => ({ id: summary.id }))
    curated.summaries = summaries
  }

  it('fills the empty panel with the session\'s suggestions', async () => {
    withSuggestions()
    mountAnonymousPanel()
    await settleSuggestions()

    expect(screen.getByText('Suggested for this session')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Suggestion \d$/ })).toHaveLength(6)
  })

  it('gives the space back to the results as soon as there is a search', async () => {
    withSuggestions()
    mountAnonymousPanel()
    await settleSuggestions()
    expect(screen.getByText('Suggested for this session')).toBeTruthy()

    typeSearch('rain')
    await settle()
    expect(screen.queryByText('Suggested for this session')).toBeNull()
    expect(screen.getByLabelText('Playlist search results')).toBeTruthy()

    typeSearch('')
    await settle()
    expect(screen.getByText('Suggested for this session')).toBeTruthy()
  })

  it('chooses a suggested playlist without connecting anything', async () => {
    withSuggestions()
    const { selectPlaylist, login } = mountAnonymousPanel()
    await settleSuggestions()

    fireEvent.click(screen.getByRole('button', { name: 'Suggestion 2' }))

    expect(selectPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }), 'panel_music')
    expect(login).not.toHaveBeenCalled()
  })

  it('starts the glow on Connect Spotify when a suggestion is clicked, as a search result does', async () => {
    withSuggestions()
    mountAnonymousPanel()
    await settleSuggestions()
    const connect = () => screen.getByRole('button', { name: 'Connect Spotify' })
    expect(connect().classList.contains('is-inviting')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Suggestion 2' }))
    expect(connect().classList.contains('is-inviting')).toBe(true)
  })

  it('plays a suggested playlist when Spotify is connected, as a search result does', async () => {
    withSuggestions()
    const { playPlaylist, selectPlaylist } = mountPanel()
    await settleSuggestions()

    fireEvent.click(screen.getByRole('button', { name: 'Suggestion 2' }))

    expect(playPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }), 'panel_music')
    expect(selectPlaylist).not.toHaveBeenCalled()
  })

  it('deals another set on Shuffle, without a reload or a login', async () => {
    withSuggestions()
    const replacements = [{ id: 's9', name: 'Suggestion 9', uri: 'spotify:playlist:s9', url: '', image: null, owner: 'Someone', trackCount: 5 }]
    curated.shuffled = replacements.map((summary) => ({ id: summary.id }))
    curated.summaries = [...summaries, ...replacements]

    const { login } = mountAnonymousPanel()
    await settleSuggestions()

    fireEvent.click(screen.getByText('Shuffle suggestions'))
    await settleSuggestions()

    expect(screen.getByRole('button', { name: 'Suggestion 9' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Suggestion 2' })).toBeNull()
    expect(login).not.toHaveBeenCalled()
  })

  // The curated file ships empty, so this is the shipped behaviour: the panel
  // reads exactly as it did, with search and Connect Spotify untouched.
  it('shows the ordinary empty list when nothing is curated', async () => {
    mountAnonymousPanel()
    await settleSuggestions()

    expect(screen.queryByText('Suggested for this session')).toBeNull()
    expect(screen.queryByText(/feel like hearing/i)).toBeNull()
    expect(document.querySelector('.playlist-list-note')).toBeNull()
    expect(screen.getByLabelText('Search playlists')).toBeTruthy()
    expect(screen.getByText('Connect Spotify')).toBeTruthy()
  })

  it('keeps search and Connect Spotify when discovery cannot be reached', async () => {
    withSuggestions()
    curated.failLookup = true
    mountAnonymousPanel()
    await settleSuggestions()

    expect(screen.queryByText('Suggested for this session')).toBeNull()
    // It says nothing about it: the panel just has none to offer.
    expect(screen.queryByText(/suggestions are unavailable/i)).toBeNull()
    expect(document.querySelector('.playlist-list-note')).toBeNull()
    expect(screen.getByLabelText('Search playlists')).toBeTruthy()
    expect(screen.getByText('Connect Spotify')).toBeTruthy()
  })

  it('stands aside once something is playing', async () => {
    withSuggestions()
    mountPanel({
      track: { title: 'Weightless', artist: 'Marconi Union', album: 'Distance', albumArt: null, url: null, durationMs: 8000, positionMs: 0, paused: false },
    })
    await settleSuggestions()

    expect(screen.queryByText('Suggested for this session')).toBeNull()
  })
})

// Cancelling at Spotify, or a code that cannot be exchanged, brings the visitor
// back signed out on a page that has reloaded, with the search and their choice
// gone. What can be given back is: the search, and a playlist (saved in the
// moment when clicked, so it only has to be shown again). A song cannot be: it
// was only ever held in memory. Found in review.
describe('Music panel after a sign-in that did not succeed', () => {
  function leaveContext(extra: {
    kind?: 'playlist' | 'track' | null
    spotifyId?: string
    query?: string
    searchType?: 'playlists' | 'tracks'
    panelId?: string
    momentId?: string
  } = {}) {
    const kind = extra.kind === undefined ? 'playlist' : extra.kind
    window.sessionStorage.setItem('mic:spotify-return-context', JSON.stringify({
      panelId: extra.panelId ?? 'panel_music',
      momentId: extra.momentId ?? 'moment_1',
      choice: kind === null ? null : { kind, spotifyId: extra.spotifyId ?? (kind === 'track' ? 't1' : 'playlist_1') },
      query: extra.query ?? 'rain',
      searchType: extra.searchType ?? 'playlists',
    }))
  }
  const failedSignIn = (overrides: Record<string, unknown> = {}, options: { strict?: boolean } = {}) =>
    mountAnonymousPanel({ signInFailed: true, ...overrides }, options)
  const storedContext = () => window.sessionStorage.getItem('mic:spotify-return-context')

  it('gives back the search, and runs it again', async () => {
    leaveContext({ query: 'rain' })
    const { searchPlaylists } = failedSignIn()
    await act(async () => { await Promise.resolve() })

    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('rain')
    await settle()
    expect(searchPlaylists).toHaveBeenCalledWith('rain')
  })

  it('gives back a song search as a song search', async () => {
    leaveContext({ kind: null, query: 'xtal', searchType: 'tracks' })
    const { searchTracks } = failedSignIn()
    await act(async () => { await Promise.resolve() })

    expect((screen.getByLabelText('Search songs') as HTMLInputElement).value).toBe('xtal')
    await settle()
    expect(searchTracks).toHaveBeenCalledWith('xtal')
  })

  // Saved in the moment when it was clicked, and hidden until chosen this visit:
  // the visitor sees nothing chosen unless it is shown again.
  it('shows the playlist that was chosen again, with what happens next', async () => {
    leaveContext({ spotifyId: 'playlist_1' })
    failedSignIn()
    await act(async () => { await Promise.resolve() })

    expect(document.querySelector('.loaded-playlist')?.textContent).toContain('Deep Focus')
    expect(screen.getByRole('status').textContent).toContain('Connect Spotify to play this playlist here')
  })

  it('does not show a saved playlist that is not the one that was chosen', async () => {
    leaveContext({ spotifyId: 'a_different_playlist' })
    failedSignIn()
    await act(async () => { await Promise.resolve() })

    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('rain')
    expect(document.querySelector('.loaded-playlist')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  // Only ever held in memory, and cannot be found without a sign-in.
  it('does not bring a chosen song back, and does not try to look it up', async () => {
    leaveContext({ kind: 'track', query: 'xtal', searchType: 'tracks' })
    const { lookupTrack } = failedSignIn()
    await act(async () => { await Promise.resolve() })

    expect((screen.getByLabelText('Search songs') as HTMLInputElement).value).toBe('xtal')
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.querySelector('.loaded-playlist')).toBeNull()
    expect(lookupTrack).not.toHaveBeenCalled()
  })

  it('uses the context up, so a later visit does not find it', async () => {
    leaveContext()
    failedSignIn()
    await act(async () => { await Promise.resolve() })

    expect(storedContext()).toBeNull()
  })

  it('does not restore what was saved for another moment or another panel', async () => {
    leaveContext({ momentId: 'moment_elsewhere' })
    failedSignIn()
    await act(async () => { await Promise.resolve() })
    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('')
    expect(document.querySelector('.loaded-playlist')).toBeNull()
    expect(storedContext()).toBeNull()
    cleanup()

    leaveContext({ panelId: 'panel_other' })
    failedSignIn()
    await act(async () => { await Promise.resolve() })
    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('')
    expect(document.querySelector('.loaded-playlist')).toBeNull()
  })

  // The other half of the rule. A sign-in that is about to succeed also opens
  // signed out for a moment, and must find its context still there.
  it('leaves the context alone when the sign-in has not been reported as failed', async () => {
    leaveContext({ query: 'rain' })
    mountAnonymousPanel()
    await act(async () => { await Promise.resolve() })

    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('')
    expect(storedContext()).not.toBeNull()
  })

  // Found by running the real page: in development React runs every effect twice
  // on mount, and the reset that runs when a moment changes ran the second time
  // after the context had been used up, and wiped what had just been restored.
  it('keeps what it gave back when React runs the effects twice, as it does in development', async () => {
    leaveContext({ query: 'rain', spotifyId: 'playlist_1' })
    failedSignIn({}, { strict: true })
    await act(async () => { await Promise.resolve() })

    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('rain')
    expect(document.querySelector('.loaded-playlist')?.textContent).toContain('Deep Focus')
    expect(screen.getByRole('status').textContent).toContain('Connect Spotify to play this playlist here')
  })

  it('does nothing when the sign-in failed but nothing had been left behind', async () => {
    failedSignIn()
    await act(async () => { await Promise.resolve() })

    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('')
    expect(document.querySelector('.loaded-playlist')).toBeNull()
  })

  it('does not run when connected, where the ordinary return does the restoring', async () => {
    leaveContext({ query: 'rain' })
    mountPanel({ signInFailed: true })
    await act(async () => { await Promise.resolve() })

    // Restored once, by the ordinary route; the context is used up either way.
    expect((screen.getByLabelText('Search playlists') as HTMLInputElement).value).toBe('rain')
    expect(storedContext()).toBeNull()
  })
})
