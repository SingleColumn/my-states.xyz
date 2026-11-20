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
 *
 * Music plays through Spotify's own embedded player. The panel once also
 * offered connecting a Spotify account and drew its own controls; that
 * approach is kept in docs/spotify-sdk-approach.md.
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
  focusView: boolean
  /** The board is showing as a moment: the music and nothing to operate. */
  momentView?: boolean
  /** The person put the search away. Only means anything once there is music. */
  searchCollapsed: boolean
  searchState: MusicSearchState
  suggestionCount: number
  /** A song picked from the results in this visit. */
  heldTrack: { id: string; name: string; artists: string; album: string; url: string; image: string | null } | null
  /** The board's saved song, if it keeps one. */
  boardTrack: { id: string; name: string; artists: string; album: string; url: string; image: string | null } | null
  /** The board's saved playlist; all null when it keeps none. */
  boardPlaylist: { id: string | null; uri: string | null; name: string | null; url: string | null; image?: string | null }
  /** Could Spotify's player load? */
  embedFailed?: boolean
  /**
   * The visitor used Spotify's player, left this tab, and came back with
   * nothing playing: most likely a trip to Spotify's site to log in.
   */
  backFromSpotify?: boolean
}

/** Spotify's own player. */
export interface MusicEmbedView {
  /** Spotify's documented compact heights, in screen pixels. */
  height: 152 | 80
  /** Kept playing but not drawn (the screenshot view shows the cover). */
  hidden: boolean
}

export interface MusicPanelView {
  /** The search field and the buttons under it. */
  showSearch: boolean
  /**
   * The visitor may put the search away once there is music, since the cover
   * and Spotify's player are what is left to show.
   */
  canPutSearchAway: boolean
  /**
   * What takes the free room in the middle of the panel. 'cover' is the music
   * shown large; 'empty' says how to start when there is nothing else.
   */
  middle: 'cover' | 'suggestions' | 'results' | 'empty' | 'none'
  /** The music the board has chosen, which Spotify's player is given. */
  chosen: MusicItem | null
  /**
   * The one place that names the music -- title, artist, album. 'cover':
   * under the large cover. 'row': a small row with the cover, used while
   * searching.
   */
  namer: 'cover' | 'row' | null
  /** The one line saying what to do next, or what is happening; never two. */
  nextStep: string | null
  /**
   * Spotify's own player, whenever something is chosen. Present in every
   * view, so a change of view never stops the music it is playing.
   */
  embed: MusicEmbedView | null
  /** Offer a reload: the one way left to pick up a Spotify login made elsewhere. */
  offerReload: boolean
}

/**
 * The music the board has chosen. A song picked in this visit comes first:
 * it was picked most recently. Then the board's saved song, then its
 * playlist; a board keeps one or the other, never both.
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
  const { focusView } = inputs
  const chosen = chosenMusic(inputs)

  // Spotify's player is there whenever there is something to play. It is
  // never taken away by a change of view, only hidden or made smaller,
  // because taking it away is what stops the music.
  const embedFor = (height: MusicEmbedView['height'], hidden = false): MusicEmbedView | null =>
    chosen && !inputs.embedFailed ? { height, hidden } : null
  const offerReload = Boolean(inputs.backFromSpotify) && chosen !== null

  // A moment shows which song it is, whatever the panel was doing: a search
  // left open or a panel in its focus view gives way to the cover, and no
  // player belongs in a picture of the board.
  if (inputs.momentView) {
    return {
      showSearch: false,
      canPutSearchAway: false,
      middle: chosen ? 'cover' : 'none',
      chosen,
      namer: chosen ? 'cover' : null,
      nextStep: null,
      embed: embedFor(focusView ? 80 : 152, true),
      offerReload: false,
    }
  }

  // The focus view is the panel at its smallest: no search and no cover.
  // Spotify's smallest player is the whole of it; the footer names the music.
  // Only a problem or coming back from Spotify earns a line of text.
  if (focusView) {
    return {
      showSearch: false,
      canPutSearchAway: false,
      middle: 'none',
      chosen,
      namer: null,
      // One short line, beside its button: the focus view has room for
      // Spotify's player and very little else, and the player matters more.
      nextStep: !chosen
        ? null
        : inputs.embedFailed
          ? 'Spotify’s player could not load here.'
          : inputs.backFromSpotify
            ? 'Welcome back. Press play again.'
            : null,
      embed: embedFor(80),
      offerReload,
    }
  }

  const canPutSearchAway = chosen !== null
  const searchHidden = inputs.searchCollapsed && canPutSearchAway
  const middle: MusicPanelView['middle'] = searchHidden
    ? 'cover'
    : inputs.searchState !== 'waiting'
      ? 'results'
      : chosen
        ? 'cover'
        : inputs.suggestionCount > 0
          ? 'suggestions'
          : 'empty'

  return {
    showSearch: !searchHidden,
    canPutSearchAway,
    middle,
    chosen,
    namer: !chosen ? null : middle === 'cover' ? 'cover' : 'row',
    nextStep: nextStep(inputs, chosen),
    embed: embedFor(152),
    offerReload,
  }
}

/**
 * Said in words because a click that seems to do nothing reads as broken.
 * What to expect from Spotify's player is said in a card when the visitor
 * first chooses something (SpotifyPreviewNotice), not as small print here.
 */
function nextStep(inputs: MusicPanelInputs, chosen: MusicItem | null): string | null {
  if (!chosen) return null
  if (inputs.embedFailed) return 'Spotify’s player could not load here. You can still listen on Spotify.'
  if (inputs.backFromSpotify) {
    return 'Welcome back to my-states. If you logged in to Spotify, press play again. Still only short previews? Reload this page. Private windows stay on previews.'
  }
  return null
}
