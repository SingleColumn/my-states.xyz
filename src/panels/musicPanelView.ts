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

/**
 * After a trip to Spotify's site, what the first press of play showed: still
 * waiting for it, 30-second previews, or whole songs.
 */
export type ReturnCheck = 'waiting' | 'previews' | 'whole'

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
   * nothing playing: most likely a trip to Spotify's site to log in. Null
   * when there was no such trip, or it has been dealt with.
   */
  returnCheck?: ReturnCheck | null
  /**
   * Spotify's player has played a whole song in this visit, so the visitor is
   * logged in to Spotify. The panel cannot see a login itself; it can only
   * see how long the song that is playing lasts.
   */
  wholeSongs?: boolean
}

/** Spotify's own player. */
export interface MusicEmbedView {
  /** Spotify's documented compact heights, in screen pixels. */
  height: 152 | 80
  /** Kept playing but not drawn (the screenshot view shows the cover). */
  hidden: boolean
}

export interface MusicPanelView {
  /** The search field. */
  showSearch: boolean
  /**
   * Reset panel and Hide search under the field. Only once there is music:
   * before that there is nothing to reset or to hide the search for, and the
   * field's own × clears what was typed.
   */
  showSearchActions: boolean
  /**
   * The visitor may put the search away once there is music, since Spotify's
   * player is what is left to show.
   */
  canPutSearchAway: boolean
  /**
   * What takes the free room in the middle of the panel. 'player': Spotify's
   * player, which shows the music's cover and name itself, so the panel adds
   * no cover of its own. 'cover': the music shown large, where there is no
   * player to show it (a moment, or a player that could not load). 'empty'
   * says how to start when there is nothing else.
   */
  middle: 'player' | 'cover' | 'suggestions' | 'results' | 'empty' | 'none'
  /** The music the board has chosen, which Spotify's player is given. */
  chosen: MusicItem | null
  /**
   * The one place in the body that names the music. 'player': Spotify's
   * player does. 'cover': the words under the panel's own cover.
   */
  namer: 'player' | 'cover' | null
  /** The one line saying what to do next, or what is happening; never two. */
  nextStep: string | null
  /**
   * Spotify's own player, whenever something is chosen. Present in every
   * view, so a change of view never stops the music it is playing.
   */
  embed: MusicEmbedView | null
  /** Offer a reload: the one way left to pick up a Spotify login made elsewhere. */
  offerReload: boolean
  /**
   * Where the way to log in to Spotify goes. 'body': in the panel, right under
   * Spotify's player (or under the line on how to start); 'footer': as small
   * print, where the body has no room. Null once whole songs play, since the
   * visitor is logged in, and wherever logging in would not help.
   */
  login: 'body' | 'footer' | null
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
  const returnCheck = chosen && !inputs.embedFailed ? inputs.returnCheck ?? null : null

  // Spotify's player is there whenever there is something to play. It is
  // never taken away by a change of view, only hidden or made smaller,
  // because taking it away is what stops the music.
  const embedFor = (height: MusicEmbedView['height'], hidden = false): MusicEmbedView | null =>
    chosen && !inputs.embedFailed ? { height, hidden } : null
  // A reload only once a press of play has shown it is needed: straight after
  // coming back, the rebuilt player may already have the login.
  const offerReload = returnCheck === 'previews'
  // Logging in changes what Spotify's player plays. With whole songs already
  // playing, or no player at all, there is nothing for it to change.
  const loginWanted = !inputs.wholeSongs && !inputs.embedFailed

  // A moment shows which song it is, whatever the panel was doing: a search
  // left open or a panel in its focus view gives way to the cover, and no
  // player belongs in a picture of the board.
  if (inputs.momentView) {
    return {
      showSearch: false,
      showSearchActions: false,
      canPutSearchAway: false,
      middle: chosen ? 'cover' : 'none',
      chosen,
      namer: chosen ? 'cover' : null,
      nextStep: null,
      embed: embedFor(focusView ? 80 : 152, true),
      offerReload: false,
      login: null,
    }
  }

  // The focus view is the panel at its smallest: no search and no cover.
  // Spotify's smallest player is the whole of it; the footer names the music.
  // Only a problem or coming back from Spotify earns a line of text.
  if (focusView) {
    return {
      showSearch: false,
      showSearchActions: false,
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
          : returnCheck === 'waiting'
            ? 'Welcome back. Press play to check.'
            : returnCheck === 'previews'
              ? 'Still previews.'
              : returnCheck === 'whole'
                ? 'Logged in: whole songs play.'
                : null,
      embed: embedFor(80),
      offerReload,
      login: chosen && loginWanted ? 'footer' : null,
    }
  }

  const canPutSearchAway = chosen !== null
  const searchHidden = inputs.searchCollapsed && canPutSearchAway
  const embed = embedFor(152)
  // With no player to show the music, the panel shows its cover instead, so
  // the music is still named somewhere.
  const resting: MusicPanelView['middle'] = embed ? 'player' : 'cover'
  const middle: MusicPanelView['middle'] = searchHidden
    ? resting
    : inputs.searchState !== 'waiting'
      ? 'results'
      : chosen
        ? resting
        : inputs.suggestionCount > 0
          ? 'suggestions'
          : 'empty'

  return {
    showSearch: !searchHidden,
    showSearchActions: !searchHidden && chosen !== null,
    canPutSearchAway,
    middle,
    chosen,
    // Spotify's player shows the cover and the name; a second cover or name
    // beside it only says the same thing twice.
    namer: !chosen ? null : embed ? 'player' : middle === 'cover' ? 'cover' : null,
    nextStep: nextStep(inputs, chosen, returnCheck),
    embed,
    offerReload,
    login: !loginWanted ? null : embed || middle === 'empty' ? 'body' : 'footer',
  }
}

/**
 * Said in words because a click that seems to do nothing reads as broken.
 * What to expect from Spotify's player is said in a card when the visitor
 * first chooses something (SpotifyPreviewNotice), not as small print here.
 */
function nextStep(inputs: MusicPanelInputs, chosen: MusicItem | null, returnCheck: ReturnCheck | null): string | null {
  if (!chosen) return null
  if (inputs.embedFailed) return 'Spotify’s player could not load here. Try again, or listen on Spotify.'
  // The panel cannot see a Spotify login, only how long the song it plays
  // lasts: 30 seconds is a preview, longer is the whole song. So the check is
  // a press of play, and the panel says so.
  if (returnCheck === 'waiting') return 'Welcome back. Press play: if whole songs play, you’re logged in.'
  if (returnCheck === 'previews') return 'Still previews. Reload this page, or use a normal (not private) window.'
  if (returnCheck === 'whole') return 'You’re logged in: whole songs will play.'
  return null
}
