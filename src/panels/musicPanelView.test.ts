import { describe, expect, it } from 'vitest'
import { musicPanelView, type MusicPanelInputs } from './musicPanelView'

const song = { id: 't1', name: 'Both Sides Now', artists: 'Frank Sinatra', album: 'Cycles', url: 'https://open.spotify.com/track/t1', image: 'https://example.test/cycles.jpg' }
const playlist = { id: 'p1', uri: 'spotify:playlist:p1', name: 'A Moveable Feast', url: 'https://open.spotify.com/playlist/p1', image: 'https://example.test/feast.jpg' }
const noPlaylist = { id: null, uri: null, name: null, url: null }
const playing = { title: 'Xtal', artist: 'Aphex Twin', album: 'SAW 85-92', albumArt: 'https://example.test/saw.jpg', url: 'https://open.spotify.com/track/x' }

/** A first visit: nothing connected, chosen, typed or playing. */
const base: MusicPanelInputs = {
  connected: false,
  focusView: false,
  searchCollapsed: false,
  searchState: 'waiting',
  suggestionCount: 0,
  playing: null,
  heldTrack: null,
  boardTrack: null,
  boardPlaylist: noPlaylist,
  cameBackToPlay: false,
  restoringSong: false,
  playerReady: true,
  sessionEnded: false,
}
const view = (overrides: Partial<MusicPanelInputs>) => musicPanelView({ ...base, ...overrides })

// One test per state the panel can be in, in the order of the table they
// were drawn up in. Each says what fills the middle, which one part names
// the music, and the one line about what to do next.
describe('musicPanelView', () => {
  describe('not connected', () => {
    it('a new board with suggestions: the suggestions, nothing named', () => {
      expect(view({ suggestionCount: 6 })).toMatchObject({ showSearch: true, middle: 'suggestions', namer: null, nextStep: null, showPlayer: false })
    })

    it('a new board without suggestions: a line saying how to start, never a blank panel', () => {
      expect(view({})).toMatchObject({ middle: 'empty', namer: null, nextStep: null })
    })

    it('a board with a song: the song large, and the step left to play it', () => {
      const result = view({ boardTrack: song, suggestionCount: 6 })
      expect(result).toMatchObject({ middle: 'cover', namer: 'cover', music: { title: 'Both Sides Now', meta: 'Frank Sinatra - Cycles', image: song.image } })
      expect(result.nextStep).toContain('Connect Spotify to play this song here')
    })

    it('a board with a playlist: the playlist large, with its own cover', () => {
      const result = view({ boardPlaylist: playlist })
      expect(result).toMatchObject({ middle: 'cover', namer: 'cover', music: { title: 'A Moveable Feast', meta: 'Playlist', image: playlist.image } })
      expect(result.nextStep).toContain('Connect Spotify to play this playlist here')
    })

    it('searching on a board with music: the results, and the music in a row beside the step', () => {
      const result = view({ boardTrack: song, searchState: 'results' })
      expect(result).toMatchObject({ middle: 'results', namer: 'row' })
      expect(result.nextStep).toContain('Connect Spotify')
    })

    it('searching on a board without music: the results alone', () => {
      expect(view({ searchState: 'results' })).toMatchObject({ middle: 'results', namer: null, nextStep: null })
    })

    it('the focus view: only the offer to connect; the footer names the music', () => {
      expect(view({ focusView: true, boardTrack: song })).toMatchObject({ connectOnly: true, showSearch: false, middle: 'none', namer: null, nextStep: null, showPlayer: false })
    })

    it('a session that ended on its own says so, ahead of anything else', () => {
      expect(view({ sessionEnded: true, boardTrack: song }).nextStep).toBe('Your Spotify connection has ended. Connect Spotify again to keep listening.')
    })

    it('cannot put the search away: there would be nothing left to use', () => {
      expect(view({ searchCollapsed: true, boardTrack: song })).toMatchObject({ showSearch: true, middle: 'cover' })
    })
  })

  describe('connected', () => {
    const on = { connected: true }

    it('no music, with suggestions: the suggestions and the player, nothing named', () => {
      expect(view({ ...on, suggestionCount: 6 })).toMatchObject({ middle: 'suggestions', namer: null, nextStep: null, showPlayer: true })
    })

    it('no music, no suggestions: a line saying how to start', () => {
      expect(view({ ...on })).toMatchObject({ middle: 'empty', namer: null })
    })

    it('a board with music, opened while connected: the music large, nothing to explain', () => {
      expect(view({ ...on, boardPlaylist: playlist })).toMatchObject({ middle: 'cover', namer: 'cover', nextStep: null })
    })

    it('back from connecting: the music large, and Play pointed out', () => {
      expect(view({ ...on, boardTrack: song, cameBackToPlay: true }).nextStep).toBe('Spotify is connected. Press play to start Both Sides Now.')
    })

    it('back from connecting before the player is ready: says it is getting ready', () => {
      expect(view({ ...on, boardTrack: song, cameBackToPlay: true, playerReady: false }).nextStep).toBe('Spotify is connected. Getting it ready to play…')
    })

    // The cover stays put while the song is looked up, rather than giving
    // way to the suggestions and coming back a moment later.
    it('back with a song still being looked up: the board\'s song large, and why Play waits', () => {
      expect(view({ ...on, boardTrack: song, cameBackToPlay: true, restoringSong: true })).toMatchObject({ middle: 'cover', namer: 'cover', nextStep: 'Getting the song you chose ready…' })
    })

    it("back with a song not yet found again: the cover waits empty, and the board's playlist is not named", () => {
      expect(view({ ...on, boardPlaylist: playlist, cameBackToPlay: true, restoringSong: true })).toMatchObject({ middle: 'cover', music: null, namer: null, nextStep: 'Getting the song you chose ready…' })
    })

    it('back from connecting, then searching: the results, the player names the music, the step stays', () => {
      const result = view({ ...on, boardTrack: song, cameBackToPlay: true, searchState: 'results' })
      expect(result).toMatchObject({ middle: 'results', namer: 'player', nextStep: 'Spotify is connected. Press play to start Both Sides Now.' })
    })

    it('a playlist chosen, not playing, searching: the player names the playlist and nothing else is said', () => {
      expect(view({ ...on, boardPlaylist: playlist, searchState: 'searching' })).toMatchObject({ middle: 'results', namer: 'player', music: { title: 'A Moveable Feast', meta: 'Playlist' }, nextStep: null })
    })

    it('playing: what is playing, large, ahead of what the board chose', () => {
      expect(view({ ...on, boardPlaylist: playlist, playing })).toMatchObject({ middle: 'cover', namer: 'cover', music: { title: 'Xtal', meta: 'Aphex Twin - SAW 85-92', image: playing.albumArt } })
    })

    it('playing, searching: the results; the player names what is playing', () => {
      expect(view({ ...on, playing, searchState: 'results' })).toMatchObject({ middle: 'results', namer: 'player', music: { title: 'Xtal' } })
    })

    it('search put away, playing: the same large view, without the search', () => {
      expect(view({ ...on, playing, searchCollapsed: true })).toMatchObject({ showSearch: false, middle: 'cover', namer: 'cover' })
    })

    it('search put away, a playlist chosen but not playing: the playlist\'s own cover, not an empty frame', () => {
      expect(view({ ...on, boardPlaylist: playlist, searchCollapsed: true })).toMatchObject({ middle: 'cover', music: { image: playlist.image } })
    })

    it('search put away with nothing chosen: an empty cover, named by nothing', () => {
      expect(view({ ...on, searchCollapsed: true })).toMatchObject({ showSearch: false, middle: 'cover', namer: null, music: null })
    })

    it('the focus view: the player names the music; no cover, no search', () => {
      expect(view({ ...on, focusView: true, playing })).toMatchObject({ connectOnly: false, showSearch: false, middle: 'none', namer: 'player', showPlayer: true })
    })
  })

  describe('what is chosen', () => {
    it('a song held for Play comes before the board\'s saved music', () => {
      const held = { ...song, id: 't2', name: 'Xtal' }
      expect(view({ heldTrack: held, boardPlaylist: playlist }).chosen).toMatchObject({ kind: 'track', title: 'Xtal' })
    })

    it('the board\'s song comes before a playlist reference', () => {
      expect(view({ boardTrack: song, boardPlaylist: playlist }).chosen).toMatchObject({ kind: 'track', title: 'Both Sides Now' })
    })
  })

  // Whatever the state, the music is named in one place at most, and only
  // where something is shown to name it.
  it('names the music in exactly one place whenever there is music, across every combination', () => {
    const flags = [false, true]
    const searches = ['waiting', 'searching', 'no-matches', 'results'] as const
    for (const connected of flags) for (const focusView of flags) for (const searchCollapsed of flags)
      for (const searchState of searches) for (const isPlaying of flags) for (const hasMusic of flags) {
        const result = view({ connected, focusView, searchCollapsed, searchState, playing: isPlaying ? playing : null, boardTrack: hasMusic ? song : null })
        const label = JSON.stringify({ connected, focusView, searchCollapsed, searchState, isPlaying, hasMusic })
        if (!result.music) expect(result.namer, label).toBeNull()
        if (result.namer === 'cover') expect(result.middle, label).toBe('cover')
        if (result.namer === 'player') expect(result.showPlayer, label).toBe(true)
        if (result.namer === 'row') expect(result.showPlayer, label).toBe(false)
        if (result.music && !focusView) expect(result.namer, label).not.toBeNull()
      }
  })
})
