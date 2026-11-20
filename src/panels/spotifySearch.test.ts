// @vitest-environment jsdom
//
// The panel searches while someone types, which is behaviour no static render
// can show: the debounce, the two-character floor, what a cleared box does to
// a reply already on its way. Two of these cover bugs found in review after
// the static tests passed, so they are written the way the panel is used —
// type, wait, look — rather than against its internals.
//
// Nobody signs in: the search goes through this app's catalog, and what is
// chosen plays in Spotify's own embedded player.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode, createElement, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PanelCommands } from '../PanelHeader'
import { PanelCommandsProvider } from '../PanelHeader'
import { SpotifyPanel } from './SpotifyPanel'
import { previewNoticeVisit } from './SpotifyPreviewNotice'

const searchDebounceMs = 300

type PanelPlaylist = { id: string | null; name: string | null; uri: string | null; url: string | null; image: string | null }
type PanelSong = { id: string; uri: string; name: string; artists: string; album: string; url: string; image: string | null; durationMs: number }
const panel = vi.hoisted(() => ({ focusView: false, boardId: 'board_1', playlist: null as unknown as PanelPlaylist, track: null as PanelSong | null }))
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

// Spotify's iFrame API, standing in for the script Spotify serves. It puts a
// real iframe where Spotify would, so focus and blur behave as in the page,
// and lets a test report playback the way Spotify's player does.
type EmbedHandler = (event: { data?: Record<string, unknown> }) => void
const embed = vi.hoisted(() => ({
  fail: false,
  created: 0,
  controllers: [] as Array<{
    uri: string
    listeners: Record<string, EmbedHandler[]>
    loadEntity: (...args: unknown[]) => void
    pause: () => void
    destroy: () => void
  }>,
}))

vi.mock('../spotifyEmbed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../spotifyEmbed')>()
  return {
    ...actual,
    loadSpotifyIframeApi: async () => {
      if (embed.fail) throw new Error('blocked')
      return {
        createController(host: HTMLElement, options: { uri?: string }, callback: (controller: unknown) => void) {
          const iframe = document.createElement('iframe')
          host.replaceWith(iframe)
          embed.created += 1
          const listeners: Record<string, EmbedHandler[]> = {}
          const controller = {
            uri: options.uri ?? '',
            listeners,
            loadEntity: vi.fn(),
            play: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            togglePlay: vi.fn(),
            addListener: (name: string, handler: EmbedHandler) => { (listeners[name] ??= []).push(handler) },
            destroy: vi.fn(() => iframe.remove()),
          }
          embed.controllers.push(controller)
          callback(controller)
        },
      }
    },
  }
})

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
    boards: { activeBoard: { id: panel.boardId } },
    panels: {
      get: () => ({
        id: 'panel_music',
        type: 'spotify',
        focusView: panel.focusView,
        config: { playlist: panel.playlist, track: panel.track },
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

// The app re-renders the panel when its state changes; the mocked state here
// is a plain object, so a change to it says so through this.
let appStateChanged = () => {}
function AppStateHarness() {
  const [, setVersion] = useState(0)
  appStateChanged = () => setVersion((version) => version + 1)
  return createElement(SpotifyPanel, { panelId: 'panel_music' })
}

/** A panel whose search calls are spies, over the results given. */
function mountPanel(overrides: Record<string, unknown> = {}, options: { strict?: boolean } = {}) {
  const searchPlaylists = vi.fn(async () => {})
  const searchTracks = vi.fn(async () => {})
  const clearSearchResults = vi.fn()
  // As in the app, choosing a playlist writes it into the board's panel, and
  // the panel draws again because the app's state changed.
  const selectPlaylist = vi.fn((summary: { id: string; name: string; uri: string; url: string; image: string | null }) => {
    panel.playlist = { id: summary.id, name: summary.name, uri: summary.uri, url: summary.url, image: summary.image }
    appStateChanged()
  })
  // As in the app, a chosen song is kept for this visit, to mark it among the results.
  const selectTrack = vi.fn((track: unknown) => {
    spotify.state.selectedTrack = track
    appStateChanged()
  })
  const loadMorePlaylists = vi.fn(async () => {})

  spotify.state = {
    tracks: [],
    playlists: [],
    selectedTrack: null,
    playlistsHaveMore: false,
    error: null,
    clearSearchResults,
    searchPlaylists,
    searchTracks,
    loadMorePlaylists,
    loadPlaylistFromUrl: async () => {},
    selectPlaylist,
    selectTrack,
    ...overrides,
  }

  const element = () => createElement(PanelCommandsProvider, {
    commands,
    children: createElement(AppStateHarness),
  })
  // The app mounts everything in React.StrictMode, which in development runs
  // every effect twice. A test that means to see what the app does asks for it.
  const view = render(element(), options.strict ? { wrapper: StrictMode } : undefined)

  // Results only ever answer a search -- clearing the box clears them -- so a
  // test that hands some in starts from a search that was typed.
  const handedResults = [overrides.playlists, overrides.tracks].some((list) => Array.isArray(list) && list.length > 0)
  const searchField = screen.queryByLabelText('Search playlists')
  if (handedResults && searchField) fireEvent.change(searchField, { target: { value: 'rain' } })

  // Re-renders the panel that is already mounted, so a change of view or of
  // session is a transition the component lives through rather than a fresh
  // mount that starts every piece of its state again. A new element each
  // time, because React skips a subtree whose element it has seen before.
  const rerender = () => act(() => { view.rerender(element()) })

  return { searchPlaylists, searchTracks, clearSearchResults, selectPlaylist, selectTrack, loadMorePlaylists, rerender }
}

/** The same panel, under the name most of these tests were written with. */
const mountAnonymousPanel = mountPanel

/** What the search looks for is a setting in the panel's ··· menu, not a control in the body. */
function chooseSearchType(type: 'playlists' | 'tracks') {
  fireEvent.click(screen.getByLabelText('Music panel actions'))
  fireEvent.click(screen.getByRole('menuitemradio', { name: type === 'tracks' ? 'Search for songs' : 'Search for playlists' }))
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
  panel.boardId = 'board_1'
  panel.playlist = { ...deepFocus }
  panel.track = null
  curated.entries = []
  curated.shuffled = []
  curated.summaries = []
  curated.failLookup = false
  previewNoticeVisit.shown = false
  embed.fail = false
  embed.created = 0
  embed.controllers = []
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

// Pasting a playlist link and signing in to a Spotify account went with the
// Web Playback SDK approach (docs/spotify-sdk-approach.md).
describe('Music panel menu', () => {
  it('offers no Spotify account and no playlist link', async () => {
    mountAnonymousPanel()
    fireEvent.click(screen.getByLabelText('Music panel actions'))
    expect(screen.queryByText('Connect Spotify account')).toBeNull()
    expect(screen.queryByText('Log out')).toBeNull()
  })

  it('has no playlist link field', async () => {
    mountAnonymousPanel()
    expect(screen.queryByText('Play from a Spotify link')).toBeNull()
    expect(screen.queryByLabelText('Spotify playlist URL')).toBeNull()
  })
})

// The music saved in a board is part of the board. Someone who imports a
// board, or is sent one, has chosen its music along with it, and expects to
// find it there.
describe('Music panel and the playlist saved in the board', () => {
  const footerName = () => document.querySelector('.card-footer-meta')?.textContent
  const chosenCard = () => document.querySelector('.spotify-chosen')

  it("shows it with its cover and Spotify's player", () => {
    panel.playlist = { ...panel.playlist, image: 'https://example.test/deep-focus.jpg' }
    mountAnonymousPanel()

    expect(chosenCard()?.textContent).toContain('Deep Focus')
    expect(chosenCard()?.querySelector('img')?.getAttribute('src')).toBe('https://example.test/deep-focus.jpg')
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.querySelector('.spotify-embed-strip')).toBeTruthy()
    expect(footerName()).toBe('Deep Focus')
  })

  it('marks it among the results', () => {
    mountAnonymousPanel({ playlists: [{ ...rainResult, id: 'playlist_1', name: 'Deep Focus' }, rainResult] })

    const saved = screen.getByText('Deep Focus', { selector: '.playlist-option strong' }).closest('button')
    expect(saved?.classList.contains('is-current')).toBe(true)
  })

  it('shows a playlist chosen now in its place', () => {
    mountAnonymousPanel({ playlists: [rainResult] })

    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

    expect(chosenCard()?.textContent).toContain('Rain on Glass')
    expect(screen.queryByRole('status')).toBeNull()
    expect(footerName()).toBe('Rain on Glass')
  })

  // A board keeps a song or a playlist, so a song chosen now is what is named.
  it('names a song chosen now instead of the saved playlist', () => {
    mountAnonymousPanel({
      tracks: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }],
    })
    chooseSearchType('tracks')
    fireEvent.click(screen.getByText('Xtal', { selector: '.playlist-option strong' }))

    expect(chosenCard()?.textContent).toContain('Xtal')
    expect(screen.queryByText('Deep Focus')).toBeNull()
  })

  it("shows the other board's music when another board is opened", () => {
    const { rerender } = mountAnonymousPanel({ playlists: [rainResult] })
    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

    panel.boardId = 'board_2'
    panel.playlist = { id: 'other', name: 'Saved Elsewhere', uri: 'spotify:playlist:other', url: null, image: null }
    rerender()

    expect(chosenCard()?.textContent).toContain('Saved Elsewhere')
    expect(chosenCard()?.textContent).not.toContain('Rain on Glass')
  })

  it('stays after the fields are reset, since the choice was made', () => {
    mountAnonymousPanel({ playlists: [rainResult] })
    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

    fireEvent.click(screen.getByText('Reset fields'))

    expect(chosenCard()?.textContent).toContain('Rain on Glass')
  })

  // The case that prompted all this: a board exported with a song, imported
  // into another browser.
  it('shows a song the board was saved with, cover and all', () => {
    panel.playlist = { ...nothingChosen }
    panel.track = { id: 't1', uri: 'spotify:track:t1', name: 'Both Sides Now', artists: 'Frank Sinatra', album: 'Cycles', url: '', image: 'https://example.test/cycles.jpg', durationMs: 175_333 }
    mountAnonymousPanel()

    expect(chosenCard()?.textContent).toContain('Both Sides Now')
    expect(chosenCard()?.textContent).toContain('Frank Sinatra - Cycles')
    expect(chosenCard()?.querySelector('img')?.getAttribute('src')).toBe('https://example.test/cycles.jpg')
    expect(screen.queryByRole('status')).toBeNull()
    expect(footerName()).toBe('Both Sides Now')
  })
})

describe('Music panel choosing music', () => {
  it('opens on the search, with no login wall and no Connect button in the body', () => {
    mountAnonymousPanel()

    expect(screen.getByLabelText('Search playlists')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /connect spotify/i })).toBeNull()
    // The card that used to be the whole body when logged out.
    expect(screen.queryByText('Play a playlist')).toBeNull()
    expect(screen.queryByText('Log in')).toBeNull()
  })

  it('searches the catalog on the same debounce', async () => {
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

  it('chooses a playlist that is clicked', async () => {
    const { selectPlaylist } = mountAnonymousPanel({
      playlists: [{ id: 'p1', name: 'Rain on Glass', uri: 'spotify:playlist:p1', url: '', image: null, owner: 'Someone', trackCount: 40 }],
    })

    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

    expect(selectPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'panel_music')
  })

  it('chooses a song that is clicked', async () => {
    const { selectTrack } = mountAnonymousPanel({
      tracks: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }],
    })

    chooseSearchType('tracks')
    fireEvent.click(screen.getByText('Xtal', { selector: '.playlist-option strong' }))

    expect(selectTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'panel_music')
  })

  // A dropdown beside the field made it the narrower half of its row, and was
  // one more thing to decide before typing. What the search looks for is a
  // setting, so it moves to the panel menu and the field takes the whole row.
  it('has no search-type dropdown in the body, and puts the choice in the panel menu', () => {
    mountAnonymousPanel()
    expect(screen.queryByLabelText('Search type')).toBeNull()
    expect(document.querySelector('.panel-body select')).toBeNull()

    fireEvent.click(screen.getByLabelText('Music panel actions'))
    expect(screen.getByRole('menuitemradio', { name: 'Search for playlists' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Search for songs' }).getAttribute('aria-checked')).toBe('false')
  })

  it('switches what the field searches for from the menu, and says so in the field', () => {
    mountAnonymousPanel()
    expect(screen.getByLabelText('Search playlists')).toBeTruthy()

    chooseSearchType('tracks')
    expect(screen.getByLabelText('Search songs')).toBeTruthy()
    expect(screen.queryByLabelText('Search playlists')).toBeNull()

    fireEvent.click(screen.getByLabelText('Music panel actions'))
    expect(screen.getByRole('menuitemradio', { name: 'Search for songs' }).getAttribute('aria-checked')).toBe('true')
  })

  it("loads a clicked result into Spotify's player, with no Connect button to point at", () => {
    mountAnonymousPanel({ playlists: [rainResult], })
    fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))
    expect(document.querySelector('.spotify-connect')).toBeNull()
    expect(document.querySelector('.spotify-embed-strip')).toBeTruthy()
  })

  it('has nothing to hide the search for until something is chosen', () => {
    panel.playlist = { ...nothingChosen }
    mountAnonymousPanel()
    expect(screen.queryByText('Hide search')).toBeNull()
    expect(screen.getByLabelText('Search playlists')).toBeTruthy()
  })

  it("puts the search away to leave the cover and Spotify's player, and brings it back", () => {
    mountAnonymousPanel()
    fireEvent.click(screen.getByText('Hide search'))

    expect(screen.queryByLabelText('Search playlists')).toBeNull()
    expect(document.querySelector('.spotify-chosen.is-featured')?.textContent).toContain('Deep Focus')
    expect(document.querySelector('.spotify-embed-strip')).toBeTruthy()

    fireEvent.click(screen.getByText('Find music'))
    expect(screen.getByLabelText('Search playlists')).toBeTruthy()
  })

  describe('the card about previews', () => {
    const card = () => screen.queryByRole('dialog', { name: 'Before you press play' })

    it('opens the first time something is chosen, and says what to expect and to come back', () => {
      mountAnonymousPanel({ playlists: [rainResult] })
      expect(card()).toBeNull()

      fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))

      expect(card()?.textContent).toContain('30-second previews')
      expect(card()?.textContent).toContain('come back to this my-states tab')
      expect(card()?.textContent).toContain('Private (incognito) windows may not recognise')
    })

    it('opens for a chosen song as well', () => {
      mountAnonymousPanel({
        tracks: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }],
      })
      chooseSearchType('tracks')
      fireEvent.click(screen.getByText('Xtal', { selector: '.playlist-option strong' }))
      expect(card()).toBeTruthy()
    })

    it('does not open for music the board was saved with', () => {
      mountAnonymousPanel()
      expect(card()).toBeNull()
    })

    it('opens only once a visit, however many times something is chosen', () => {
      mountAnonymousPanel({ playlists: [rainResult] })
      const row = () => screen.getByText('Rain on Glass', { selector: '.playlist-option strong' })
      fireEvent.click(row())
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      fireEvent.click(row())
      expect(card()).toBeNull()
    })

    it('stays closed for good when asked not to show again', () => {
      mountAnonymousPanel({ playlists: [rainResult] })
      fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))
      fireEvent.click(screen.getByLabelText("Don't show this again"))
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      cleanup()

      previewNoticeVisit.shown = false
      mountAnonymousPanel({ playlists: [rainResult] })
      fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))
      expect(card()).toBeNull()
      window.localStorage.removeItem('mic:spotify-preview-notice-hidden')
    })

    it('closes on Escape', () => {
      mountAnonymousPanel({ playlists: [rainResult] })
      fireEvent.click(screen.getByText('Rain on Glass', { selector: '.playlist-option strong' }))
      fireEvent.keyDown(card()!, { key: 'Escape' })
      expect(card()).toBeNull()
    })

    it('can be opened again from the footer', () => {
      mountAnonymousPanel()
      fireEvent.click(screen.getByRole('button', { name: 'Previews without a login' }))
      expect(card()).toBeTruthy()
    })

  })

  it('has no Connect Spotify button in the body, whether or not something is chosen', () => {
    mountAnonymousPanel()
    expect(screen.queryAllByRole('button', { name: /connect spotify/i })).toHaveLength(0)
    cleanup()

    mountAnonymousPanel({
      selectedTrack: { id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: 'https://open.spotify.com/track/t1', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 },
    })
    expect(screen.queryAllByRole('button', { name: /connect spotify/i })).toHaveLength(0)
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

  // Suggestions fill a panel with no music yet. A board that has music shows
  // that instead (see the test after these), so these start from one without.
  function withSuggestions() {
    panel.playlist = { ...nothingChosen }
    curated.entries = summaries.map((summary) => ({ id: summary.id }))
    curated.summaries = summaries
  }

  it("gives way to the board's own music when it has some, shown large", async () => {
    curated.entries = summaries.map((summary) => ({ id: summary.id }))
    curated.summaries = summaries
    mountAnonymousPanel()
    await settleSuggestions()

    expect(screen.queryByText('Suggested for this session')).toBeNull()
    expect(document.querySelector('.spotify-chosen.is-featured')?.textContent).toContain('Deep Focus')
  })

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

  it('chooses a suggested playlist', async () => {
    withSuggestions()
    const { selectPlaylist } = mountAnonymousPanel()
    await settleSuggestions()

    fireEvent.click(screen.getByRole('button', { name: 'Suggestion 2' }))

    expect(selectPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }), 'panel_music')
  })

  it("loads a clicked suggestion into Spotify's player, as a search result does", async () => {
    withSuggestions()
    panel.playlist = { ...nothingChosen }
    mountAnonymousPanel()
    await settleSuggestions()
    expect(document.querySelector('.spotify-embed-strip')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Suggestion 2' }))
    expect(document.querySelector('.spotify-embed-strip')).toBeTruthy()
  })

  it('deals another set on Shuffle, without a reload', async () => {
    withSuggestions()
    const replacements = [{ id: 's9', name: 'Suggestion 9', uri: 'spotify:playlist:s9', url: '', image: null, owner: 'Someone', trackCount: 5 }]
    curated.shuffled = replacements.map((summary) => ({ id: summary.id }))
    curated.summaries = [...summaries, ...replacements]

    mountAnonymousPanel()
    await settleSuggestions()

    fireEvent.click(screen.getByText('Shuffle suggestions'))
    await settleSuggestions()

    expect(screen.getByRole('button', { name: 'Suggestion 9' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Suggestion 2' })).toBeNull()
  })

  // The curated file ships empty, so this is the shipped behaviour: the panel
  // reads exactly as it did, with the search untouched.
  it('shows the ordinary empty list when nothing is curated', async () => {
    mountAnonymousPanel()
    await settleSuggestions()

    expect(screen.queryByText('Suggested for this session')).toBeNull()
    expect(screen.queryByText(/feel like hearing/i)).toBeNull()
    expect(document.querySelector('.playlist-list-note')).toBeNull()
    expect(screen.getByLabelText('Search playlists')).toBeTruthy()
  })

  it('keeps search when discovery cannot be reached', async () => {
    withSuggestions()
    curated.failLookup = true
    mountAnonymousPanel()
    await settleSuggestions()

    expect(screen.queryByText('Suggested for this session')).toBeNull()
    // It says nothing about it: the panel just has none to offer.
    expect(screen.queryByText(/suggestions are unavailable/i)).toBeNull()
    expect(document.querySelector('.playlist-list-note')).toBeNull()
    expect(screen.getByLabelText('Search playlists')).toBeTruthy()
  })

})

// The music's title, artist and album are said once, wherever the panel is.
// Two parts of it can name them -- the large view and the row above the note
// -- and each used to decide for itself; every new view found a state where
// both did at once. These walk through the states one by
// one, so the next view to be added is checked against all of them too.
describe('Music panel names its music once, in every state', () => {
  const song = { id: 't1', uri: 'spotify:track:t1', name: 'Both Sides Now', artists: 'Frank Sinatra', album: 'Cycles', url: '', image: null, durationMs: 175_333 }

  function expectNamedOnce() {
    const titles = [...document.querySelectorAll('.track-title')].filter((node) => node.textContent === 'Both Sides Now')
    const metas = [...document.querySelectorAll('.track-meta')].filter((node) => node.textContent === 'Frank Sinatra - Cycles')
    expect(titles).toHaveLength(1)
    expect(metas).toHaveLength(1)
  }

  async function searchWithResults() {
    typeSearch('rain')
    await settle()
  }

  beforeEach(() => {
    panel.playlist = { ...nothingChosen }
    panel.track = { ...song }
  })

  it('nothing searched', () => {
    mountAnonymousPanel()
    expectNamedOnce()
  })

  it('with search results', async () => {
    mountAnonymousPanel({ playlists: [rainResult] })
    await searchWithResults()
    expectNamedOnce()
  })

  // The focus view has room for Spotify's player alone, so the footer names it.
  it('in the focus view, in the footer', () => {
    panel.focusView = true
    mountPanel()
    expect(document.querySelectorAll('.track-title')).toHaveLength(0)
    expect(document.querySelector('.card-footer-meta')?.textContent).toBe('Song: Both Sides Now')
  })
})

// Spotify's own player, which plays all the panel's music. Most of
// what matters happens inside Spotify's iframe, where this page cannot see;
// these cover what the page itself decides.
describe("Music panel with Spotify's own player", () => {
  /** Let the stand-in iFrame API answer, which is a promise, not a timer. */
  async function settlePlayer() {
    await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() })
  }

  const latest = () => embed.controllers[embed.controllers.length - 1]

  /** What the browser does when someone clicks inside Spotify's iframe. */
  function useThePlayer() {
    const iframe = document.querySelector<HTMLIFrameElement>('.spotify-embed-strip iframe')!
    iframe.focus()
    act(() => { window.dispatchEvent(new Event('blur')) })
  }

  let visibility: DocumentVisibilityState = 'visible'
  beforeEach(() => {
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  })

  function leaveTheTab() {
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  }

  function comeBack() {
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  }

  function reportPlaying(isPaused: boolean) {
    act(() => { for (const handler of latest().listeners.playback_update ?? []) handler({ data: { isPaused } }) })
  }

  it("loads the board's playlist into one player, and waits for a press of play", async () => {
    mountAnonymousPanel()
    await settlePlayer()

    expect(embed.created).toBe(1)
    expect(latest().uri).toBe('spotify:playlist:1')
  })

  it('gives a chosen song to the same player, without building another', async () => {
    mountAnonymousPanel({
      tracks: [{ id: 't1', name: 'Xtal', uri: 'spotify:track:t1', url: '', image: null, artists: 'Aphex Twin', album: 'SAW 85-92', durationMs: 1000 }],
    })
    await settlePlayer()
    chooseSearchType('tracks')
    fireEvent.click(screen.getByText('Xtal', { selector: '.playlist-option strong' }))
    await settlePlayer()

    expect(embed.created).toBe(1)
    expect(latest().loadEntity).toHaveBeenCalledWith('spotify:track:t1')
  })

  it('welcomes the visitor back after they used the player and left the tab, and builds a new player', async () => {
    mountAnonymousPanel()
    await settlePlayer()

    useThePlayer()
    leaveTheTab()
    comeBack()
    await settlePlayer()

    expect(screen.getByRole('status').textContent).toContain('Welcome back to my-states')
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy()
    // A new player, so a Spotify login made meanwhile has a chance to count.
    expect(embed.created).toBe(2)
    expect(embed.controllers[0].destroy).toHaveBeenCalled()
  })

  it('says nothing, and leaves the music alone, when it is still playing on return', async () => {
    mountAnonymousPanel()
    await settlePlayer()

    useThePlayer()
    reportPlaying(false)
    leaveTheTab()
    comeBack()

    expect(screen.queryByRole('status')?.textContent ?? '').not.toContain('Welcome back')
    expect(embed.created).toBe(1)
  })

  it('says nothing to someone who only switched tabs without touching the player', async () => {
    mountAnonymousPanel()
    await settlePlayer()

    leaveTheTab()
    comeBack()

    expect(screen.queryByRole('status')?.textContent ?? '').not.toContain('Welcome back')
    expect(embed.created).toBe(1)
  })

  it('lets the welcome go once the music starts', async () => {
    mountAnonymousPanel()
    await settlePlayer()
    useThePlayer()
    leaveTheTab()
    comeBack()
    await settlePlayer()

    reportPlaying(false)

    expect(screen.queryByRole('status')?.textContent ?? '').not.toContain('Welcome back')
    expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull()
  })

  it("stops the music and loads the other board's choice when another board is opened", async () => {
    const { rerender } = mountAnonymousPanel()
    await settlePlayer()

    panel.boardId = 'board_2'
    panel.playlist = { id: 'other', name: 'Saved Elsewhere', uri: 'spotify:playlist:other', url: null, image: null }
    rerender()
    await settlePlayer()

    expect(latest().pause).toHaveBeenCalled()
    expect(latest().loadEntity).toHaveBeenCalledWith('spotify:playlist:other')
  })

  it('takes the player away, and its music with it, on a board with nothing chosen', async () => {
    const { rerender } = mountAnonymousPanel()
    await settlePlayer()

    panel.boardId = 'board_2'
    panel.playlist = { ...nothingChosen }
    rerender()

    expect(embed.controllers[0].destroy).toHaveBeenCalled()
    expect(document.querySelector('.spotify-embed-strip')).toBeNull()
  })

  it('destroys the player when the panel goes', async () => {
    mountAnonymousPanel()
    await settlePlayer()

    cleanup()

    expect(embed.controllers[0].destroy).toHaveBeenCalled()
  })

  it('keeps the same player in the focus view, at its smaller size', async () => {
    const { rerender } = mountAnonymousPanel()
    await settlePlayer()

    panel.focusView = true
    rerender()
    await settlePlayer()

    expect(embed.created).toBe(1)
    expect(document.querySelector('.spotify-embed-strip')).toBeTruthy()
  })

  it("says so, and offers Spotify itself, when Spotify's player cannot load", async () => {
    embed.fail = true
    panel.playlist = { ...deepFocus, url: 'https://open.spotify.com/playlist/1' }
    mountAnonymousPanel()
    await settlePlayer()

    expect(screen.getByRole('status').textContent).toContain('could not load')
    expect(screen.getByRole('link', { name: 'Open in Spotify' }).getAttribute('href')).toBe('https://open.spotify.com/playlist/1')
    expect(document.querySelector('.spotify-embed-strip')).toBeNull()
  })

})
