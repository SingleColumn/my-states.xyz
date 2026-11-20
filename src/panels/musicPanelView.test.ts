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

  it("a board with a song: the song large, Spotify's player under it", () => {
    const result = view({ boardTrack: song, suggestionCount: 6 })
    expect(result).toMatchObject({ middle: 'cover', namer: 'cover', chosen: { title: 'Both Sides Now', meta: 'Frank Sinatra - Cycles', image: song.image }, embed: { height: 152, hidden: false } })
    // What to expect is said in a card (SpotifyPreviewNotice), not here.
    expect(result.nextStep).toBeNull()
  })

  it('a board with a playlist: the playlist large, with its own cover', () => {
    const result = view({ boardPlaylist: playlist })
    expect(result).toMatchObject({ middle: 'cover', namer: 'cover', chosen: { title: 'A Moveable Feast', meta: 'Playlist', image: playlist.image } })
    expect(result.embed).toEqual({ height: 152, hidden: false })
  })

  it("searching on a board with music: the results, the music in a row, and Spotify's player kept", () => {
    const result = view({ boardTrack: song, searchState: 'results' })
    expect(result).toMatchObject({ middle: 'results', namer: 'row', embed: { height: 152 } })
    expect(result.nextStep).toBeNull()
  })

  it('searching on a board without music: the results alone, and no player', () => {
    expect(view({ searchState: 'results' })).toMatchObject({ middle: 'results', namer: null, nextStep: null, embed: null })
  })

  it("the focus view: Spotify's smallest player alone; the footer names the music", () => {
    expect(view({ focusView: true, boardTrack: song })).toMatchObject({ showSearch: false, middle: 'none', namer: null, nextStep: null, embed: { height: 80, hidden: false } })
  })

  it('back from Spotify with nothing playing: welcomed back, told to press play, offered a reload', () => {
    const result = view({ boardPlaylist: playlist, backFromSpotify: true })
    expect(result.nextStep).toContain('Welcome back to my-states')
    expect(result).toMatchObject({ offerReload: true, embed: { height: 152 } })
  })

  it('back from Spotify in the focus view: the same, in one short line', () => {
    expect(view({ focusView: true, boardPlaylist: playlist, backFromSpotify: true })).toMatchObject({ nextStep: 'Welcome back. Press play again.', offerReload: true, embed: { height: 80 } })
  })

  it("Spotify's player could not load: no player, and a line saying so", () => {
    const result = view({ boardPlaylist: playlist, embedFailed: true })
    expect(result.embed).toBeNull()
    expect(result.nextStep).toContain('could not load')
  })

  it("can put the search away once there is music: the cover and Spotify's player are what is left", () => {
    expect(view({ searchCollapsed: true, boardTrack: song })).toMatchObject({ canPutSearchAway: true, showSearch: false, middle: 'cover', embed: { height: 152 } })
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
