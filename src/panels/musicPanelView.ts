/**
 * What the Music panel shows, decided in one place.
 *
 * The panel used to decide each of its parts on its own -- the cover, the
 * line naming the song, the note saying what to do next -- and every view
 * added later found a state in which two parts said the same thing, or none
 * said anything. Here the whole view is worked out from the panel's inputs
 * at once, and the component only draws what this returns. A new view is a
 * change to this function, where every other state is in sight, and its
 * tests walk through each state the panel can be in.
 */

export type MusicSearchState = 'waiting' | 'searching' | 'no-matches' | 'results'

/** A song or playlist as the panel describes it. */
export interface MusicItem {
  kind: 'playlist' | 'track'
  id: string
  title: string
  /** "Artist - Album" for a song; "Playlist" for a playlist. */
  meta: string
  image: string | null
  url: string | null
}

export interface MusicPanelInputs {
  connected: boolean
  focusView: boolean
  /** The board is showing as a moment: the music and nothing to operate. */
  momentView?: boolean
  /** The person put the search away. Only means anything when connected. */
  searchCollapsed: boolean
  searchState: MusicSearchState
  suggestionCount: number
  /** What Spotify reports playing, if anything. */
  playing: { title: string; artist: string; album: string; albumArt: string | null; url: string | null } | null
  /** A song held for Play: chosen, or looked up again after connecting. */
  heldTrack: { id: string; name: string; artists: string; album: string; url: string; image: string | null } | null
  /** The board's saved song, if it keeps one. */
  boardTrack: { id: string; name: string; artists: string; album: string; url: string; image: string | null } | null
  /** The board's saved playlist; all null when it keeps none. */
  boardPlaylist: { id: string | null; uri: string | null; name: string | null; url: string | null; image?: string | null }
  /** Back from connecting, with the choice made before leaving waiting for Play. */
  cameBackToPlay: boolean
  /** Back from connecting with a song, which is being looked up again. */
  restoringSong: boolean
  /** Spotify's player in this page is ready to play. */
  playerReady: boolean
  /** The Spotify session ended on its own (expired), not by logging out. */
  sessionEnded: boolean
}

export interface MusicPanelView {
  /** Not connected and in the focus view: only the offer to connect. */
  connectOnly: boolean
  /** The search field and the buttons under it. */
  showSearch: boolean
  /**
   * What takes the free room in the middle of the panel. 'cover' is the music
   * shown large; 'empty' says how to start when there is nothing else.
   */
  middle: 'cover' | 'suggestions' | 'results' | 'empty' | 'none'
  /** The music the panel is about: what is playing, else what is chosen. */
  music: MusicItem | null
  /** The music the board has chosen, which Play starts when nothing plays. */
  chosen: MusicItem | null
  /**
   * The one place that names the music -- title, artist, album. 'cover':
   * under the large cover. 'row': a small row with the cover, used while
   * searching before connecting. 'player': the player's title line.
   */
  namer: 'cover' | 'row' | 'player' | null
  /** The one line saying what to do next, or what is happening; never two. */
  nextStep: string | null
  /** The playback controls: connected, in every view. */
  showPlayer: boolean
}

/**
 * The music the board has chosen. A song held for Play comes first: it was
 * picked most recently. Then the board's saved song, then its playlist; a
 * board keeps one or the other, never both.
 */
export function chosenMusic(inputs: Pick<MusicPanelInputs, 'heldTrack' | 'boardTrack' | 'boardPlaylist'>): MusicItem | null {
  const track = inputs.heldTrack ?? inputs.boardTrack
  if (track) {
    return { kind: 'track', id: track.id, title: track.name, meta: `${track.artists} - ${track.album}`, image: track.image, url: track.url || null }
  }
  const playlist = inputs.boardPlaylist
  if (!playlist.id || !playlist.uri) return null
  return { kind: 'playlist', id: playlist.id, title: playlist.name ?? 'Playlist', meta: 'Playlist', image: playlist.image ?? null, url: playlist.url }
}

export function musicPanelView(inputs: MusicPanelInputs): MusicPanelView {
  const { connected, focusView, playing } = inputs
  // While a song chosen before connecting is looked up again, it is the song
  // that will play: the board's playlist must not be named in its place.
  const chosen = inputs.restoringSong && !(inputs.heldTrack ?? inputs.boardTrack) ? null : chosenMusic(inputs)
  const music: MusicItem | null = playing
    ? { kind: 'track', id: playing.url ?? playing.title, title: playing.title, meta: `${playing.artist} - ${playing.album}`, image: playing.albumArt, url: playing.url }
    : chosen

  // A moment shows which song it is, whatever the panel was doing: a search
  // left open or a panel in its focus view gives way to the cover, and no
  // connecting step or player belongs in a picture of the board.
  if (inputs.momentView) {
    return {
      connectOnly: false,
      showSearch: false,
      middle: music ? 'cover' : 'none',
      music,
      chosen,
      namer: music ? 'cover' : null,
      nextStep: null,
      showPlayer: false,
    }
  }

  // The focus view is the panel at its smallest: no search and no cover.
  // Not connected, all it can usefully offer is the way to connect; the
  // footer names the music.
  if (focusView) {
    return {
      connectOnly: !connected,
      showSearch: false,
      middle: 'none',
      music,
      chosen,
      namer: connected && music ? 'player' : null,
      nextStep: null,
      showPlayer: connected,
    }
  }

  // Putting the search away is offered only when connected, where it
  // leaves the cover and the player.
  const searchHidden = inputs.searchCollapsed && connected
  const middle: MusicPanelView['middle'] = searchHidden
    ? 'cover'
    : inputs.searchState !== 'waiting'
      ? 'results'
      : music || inputs.restoringSong
        ? 'cover'
        : inputs.suggestionCount > 0
          ? 'suggestions'
          : 'empty'

  const namer: MusicPanelView['namer'] = !music
    ? null
    : middle === 'cover'
      ? 'cover'
      : connected
        ? 'player'
        : 'row'

  return {
    connectOnly: false,
    showSearch: !searchHidden,
    middle,
    music,
    chosen,
    namer,
    nextStep: nextStep(inputs, chosen),
    showPlayer: connected,
  }
}

/**
 * Said in words because a click that seems to do nothing reads as broken.
 * In order of what matters most: something in progress, a session that
 * ended, then the one step left before the chosen music can play.
 */
function nextStep(inputs: MusicPanelInputs, chosen: MusicItem | null): string | null {
  if (inputs.restoringSong) return 'Getting the song you chose ready…'
  if (!inputs.connected && inputs.sessionEnded) {
    return 'Your Spotify connection has ended. Connect Spotify again to keep listening.'
  }
  if (!inputs.connected) {
    return chosen
      ? `Connect Spotify to play this ${chosen.kind === 'track' ? 'song' : 'playlist'} here. You will come straight back to this page.`
      : null
  }
  if (inputs.cameBackToPlay && !inputs.playing && chosen) {
    return inputs.playerReady
      ? `Spotify is connected. Press play to start ${chosen.title}.`
      : 'Spotify is connected. Getting it ready to play…'
  }
  return null
}
