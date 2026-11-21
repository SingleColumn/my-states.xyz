import { describe, expect, it } from 'vitest'
import { musicPanelView, type MusicPanelInputs } from './musicPanelView'

const song = { id: 't1', name: 'Both Sides Now', artists: 'Frank Sinatra', album: 'Cycles', url: 'https://open.spotify.com/track/t1', image: 'https://example.test/cycles.jpg' }
const playlist = { id: 'p1', uri: 'spotify:playlist:p1', name: 'A Moveable Feast', url: 'https://open.spotify.com/playlist/p1', image: 'https://example.test/feast.jpg' }
const noPlaylist = { id: null, uri: null, name: null, url: null }

/** A first visit: nothing chosen or typed. */
const base: MusicPanelInputs = {
  focusView: false,
  searchCollapsed: false,
  searchState: 'waiting',
  suggestionCount: 0,
  heldTrack: null,
  boardTrack: null,
  boardPlaylist: noPlaylist,
}
const view = (overrides: Partial<MusicPanelInputs>) => musicPanelView({ ...base, ...overrides })

// One test per state the panel can be in. Each says what fills the middle,
// which one part names the music, and the one line about what to do next.
describe('musicPanelView', () => {
  it('a new board with suggestions: the suggestions, nothing named', () => {
    expect(view({ suggestionCount: 6 })).toMatchObject({ showSearch: true, middle: 'suggestions', namer: null, nextStep: null, embed: null })
  })

  it('a new board without suggestions: a line saying how to start, never a blank panel', () => {
    expect(view({})).toMatchObject({ middle: 'empty', namer: null, nextStep: null })
  })

  it("a board with a song: Spotify's player alone, which shows the cover and names the song", () => {
    const result = view({ boardTrack: song, suggestionCount: 6 })
    expect(result).toMatchObject({ middle: 'player', namer: 'player', chosen: { title: 'Both Sides Now', meta: 'Frank Sinatra - Cycles', image: song.image }, embed: { height: 152, hidden: false }, showSearchActions: true, login: 'body' })
    // What to expect is said in a card (SpotifyPreviewNotice), not here.
    expect(result.nextStep).toBeNull()
  })

  it("a board with a playlist: Spotify's player, never a second cover beside it", () => {
    const result = view({ boardPlaylist: playlist })
    expect(result).toMatchObject({ middle: 'player', namer: 'player', chosen: { title: 'A Moveable Feast', meta: 'Playlist', image: playlist.image } })
    expect(result.embed).toEqual({ height: 152, hidden: false })
  })

  it("searching on a board with music: the results, and Spotify's player kept to name the music", () => {
    const result = view({ boardTrack: song, searchState: 'results' })
    expect(result).toMatchObject({ middle: 'results', namer: 'player', embed: { height: 152 }, showSearchActions: true, login: 'body' })
    expect(result.nextStep).toBeNull()
  })

  it('searching on a board without music: the results alone, no player, no Reset panel', () => {
    expect(view({ searchState: 'results' })).toMatchObject({ middle: 'results', namer: null, nextStep: null, embed: null, showSearchActions: false, login: 'footer' })
  })

  it('a new board offers the login under its line on how to start, with no buttons under the search', () => {
    expect(view({})).toMatchObject({ showSearchActions: false, login: 'body' })
  })

  it("the focus view: Spotify's smallest player alone; the footer names the music", () => {
    expect(view({ focusView: true, boardTrack: song })).toMatchObject({ showSearch: false, middle: 'none', namer: null, nextStep: null, embed: { height: 80, hidden: false } })
  })

  it('back from Spotify: welcomed back and told that play is the check, no reload yet', () => {
    const result = view({ boardPlaylist: playlist, returnCheck: 'waiting' })
    expect(result.nextStep).toContain('Welcome back. Press play')
    expect(result).toMatchObject({ offerReload: false, embed: { height: 152 }, login: 'body' })
  })

  it('back from Spotify and still previews: told how to get whole songs, offered a reload', () => {
    const result = view({ boardPlaylist: playlist, returnCheck: 'previews' })
    expect(result.nextStep).toContain('Still previews')
    expect(result).toMatchObject({ offerReload: true, login: 'body' })
  })

  it('back from Spotify and whole songs: told so, and no login offered any more', () => {
    const result = view({ boardPlaylist: playlist, returnCheck: 'whole', wholeSongs: true })
    expect(result.nextStep).toContain('logged in')
    expect(result).toMatchObject({ offerReload: false, login: null })
  })

  it('whole songs heard in this visit: no login offered anywhere', () => {
    for (const inputs of [{ boardPlaylist: playlist }, {}, { focusView: true, boardPlaylist: playlist }, { searchState: 'results' as const }]) {
      expect(view({ ...inputs, wholeSongs: true }).login).toBeNull()
    }
  })

  it('back from Spotify in the focus view: the same, in one short line', () => {
    expect(view({ focusView: true, boardPlaylist: playlist, returnCheck: 'waiting' })).toMatchObject({ nextStep: 'Welcome back. Press play to check.', offerReload: false, embed: { height: 80 }, login: 'footer' })
    expect(view({ focusView: true, boardPlaylist: playlist, returnCheck: 'previews' })).toMatchObject({ nextStep: 'Still previews.', offerReload: true })
  })

  it("Spotify's player could not load: no player, so the panel's own cover names the music, and a line saying so", () => {
    const result = view({ boardPlaylist: playlist, embedFailed: true })
    expect(result).toMatchObject({ embed: null, middle: 'cover', namer: 'cover', login: null })
    expect(result.nextStep).toContain('could not load')
  })

  it("can put the search away once there is music: Spotify's player is what is left", () => {
    expect(view({ searchCollapsed: true, boardTrack: song })).toMatchObject({ canPutSearchAway: true, showSearch: false, showSearchActions: false, middle: 'player', embed: { height: 152 } })
  })

  it('cannot put the search away with nothing chosen: there would be nothing left to show', () => {
    expect(view({ searchCollapsed: true })).toMatchObject({ canPutSearchAway: false, showSearch: true })
  })

  describe('what is chosen', () => {
    it("a song picked in this visit comes before the board's saved music", () => {
      const held = { ...song, id: 't2', name: 'Xtal' }
      expect(view({ heldTrack: held, boardPlaylist: playlist }).chosen).toMatchObject({ kind: 'track', title: 'Xtal' })
    })

    it("the board's song comes before a playlist reference", () => {
      expect(view({ boardTrack: song, boardPlaylist: playlist }).chosen).toMatchObject({ kind: 'track', title: 'Both Sides Now' })
    })
  })

  // Whatever the state, the music is named in one place at most, and only
  // where something is shown to name it.
  it('names the music in exactly one place whenever there is music, across every combination', () => {
    const flags = [false, true]
    const searches = ['waiting', 'searching', 'no-matches', 'results'] as const
    for (const focusView of flags) for (const searchCollapsed of flags)
      for (const searchState of searches) for (const hasMusic of flags) {
        const result = view({ focusView, searchCollapsed, searchState, boardTrack: hasMusic ? song : null })
        const label = JSON.stringify({ focusView, searchCollapsed, searchState, hasMusic })
        if (!result.chosen) expect(result.namer, label).toBeNull()
        if (result.namer === 'cover') expect(result.middle, label).toBe('cover')
        // Spotify's player names the music, so the panel never draws its own
        // cover beside it.
        if (result.embed && !result.embed.hidden) expect(result.middle, label).not.toBe('cover')
        if (result.chosen && !focusView) expect(result.namer, label).not.toBeNull()
      }
  })
})

describe('musicPanelView in a moment', () => {
  it('shows the music on its own, whatever the panel was doing', () => {
    for (const focusView of [false, true]) for (const searchState of ['waiting', 'results'] as const) {
      const result = view({ momentView: true, focusView, searchState, boardTrack: song })
      expect(result).toMatchObject({ showSearch: false, middle: 'cover', namer: 'cover', nextStep: null })
      expect(result.chosen?.title).toBe('Both Sides Now')
      // Kept but hidden: taking the player away would stop the music.
      expect(result.embed).toEqual({ height: focusView ? 80 : 152, hidden: true })
    }
  })

  it('shows a playlist when no song is chosen', () => {
    expect(view({ momentView: true, boardPlaylist: playlist }).chosen?.title).toBe('A Moveable Feast')
  })

  it('has nothing to show when no music is chosen', () => {
    expect(view({ momentView: true })).toMatchObject({ middle: 'none', chosen: null, namer: null, embed: null })
  })
})
